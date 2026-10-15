import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type { PluginInput } from "@opencode-ai/plugin"

import { DockerExecPlugin } from "../src/index.js"

async function fakeInput(): Promise<PluginInput> {
  const dir = await mkdtemp(join(tmpdir(), "docker-exec-plugin-"))
  return {
    client: { app: { log: async () => {} } },
    project: {},
    directory: dir,
    worktree: dir,
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: (() => {}) as unknown,
  } as unknown as PluginInput
}

const beforeInput = { tool: "bash", sessionID: "s", callID: "c" }

test("registers the interceptor and management tool when dynamic", async () => {
  const hooks = await DockerExecPlugin(await fakeInput(), { container: "dev" })
  assert.equal(typeof hooks["tool.execute.before"], "function")
  assert.ok(hooks.tool?.docker_exec)
})

test("injects TUI slash commands through the config hook", async () => {
  const hooks = await DockerExecPlugin(await fakeInput(), {
    container: "base",
    profiles: { postgres: { container: "pg-dev" } },
  })
  const cfg: { command?: Record<string, { template: string }> } = { command: { existing: { template: "keep me" } } }
  await hooks.config?.(cfg as never)
  assert.ok(cfg.command?.docker)
  assert.ok(cfg.command?.["docker-postgres"])
  assert.equal(cfg.command?.existing.template, "keep me")
})

test("does not inject commands when disabled", async () => {
  const hooks = await DockerExecPlugin(await fakeInput(), { container: "base", commands: false })
  const cfg: { command?: Record<string, unknown> } = {}
  await hooks.config?.(cfg as never)
  assert.equal(cfg.command, undefined)
})

test("omits the management tool when dynamic is disabled", async () => {
  const hooks = await DockerExecPlugin(await fakeInput(), { container: "dev", dynamic: false })
  assert.equal(typeof hooks["tool.execute.before"], "function")
  assert.equal(hooks.tool, undefined)
})

test("is inactive without a container or command", async () => {
  const hooks = await DockerExecPlugin(await fakeInput(), { dynamic: false })
  assert.deepEqual(hooks, {})
})

test("rewrites the command to run inside the container", async () => {
  const hooks = await DockerExecPlugin(await fakeInput(), { container: "dev", dynamic: false })
  const output = { args: { command: "uname -a" } }
  await hooks["tool.execute.before"]!(beforeInput, output)
  assert.equal(output.args.command, "'docker' exec 'dev' 'bash' -c 'uname -a'")
})

test("leaves other tools untouched", async () => {
  const hooks = await DockerExecPlugin(await fakeInput(), { container: "dev", dynamic: false })
  const output = { args: { command: "uname -a" } }
  await hooks["tool.execute.before"]!({ ...beforeInput, tool: "read" }, output)
  assert.equal(output.args.command, "uname -a")
})

test("honours the dynamic state file", async () => {
  const input = await fakeInput()
  await mkdir(join(input.worktree, ".opencode"), { recursive: true })
  await writeFile(
    join(input.worktree, ".opencode", "docker-exec.json"),
    JSON.stringify({ container: "dynamic-dev" }),
    "utf8",
  )

  const hooks = await DockerExecPlugin(input, { container: "base" })
  const output = { args: { command: "pwd" } }
  await hooks["tool.execute.before"]!(beforeInput, output)
  assert.equal(output.args.command, "'docker' exec 'dynamic-dev' 'bash' -c 'pwd'")
})

test("docker_exec can switch the target mid-session", async () => {
  const input = await fakeInput()
  const hooks = await DockerExecPlugin(input, { container: "base" })
  const dockerExec = hooks.tool!.docker_exec!

  const result = await dockerExec.execute({ action: "set", target: "switched" }, {} as never)
  assert.match(String(result), /switched/)

  const output = { args: { command: "pwd" } }
  await hooks["tool.execute.before"]!(beforeInput, output)
  assert.equal(output.args.command, "'docker' exec 'switched' 'bash' -c 'pwd'")
})

test("docker_exec 'use' selects a profile and 'reset' reverts", async () => {
  const input = await fakeInput()
  const hooks = await DockerExecPlugin(input, {
    container: "base",
    profiles: { postgres: { container: "pg-dev", workdir: "/pg" } },
  })
  const dockerExec = hooks.tool!.docker_exec!

  await dockerExec.execute({ action: "use", target: "postgres" }, {} as never)
  const output = { args: { command: "pwd" } }
  await hooks["tool.execute.before"]!(beforeInput, output)
  assert.equal(output.args.command, "'docker' exec -w '/pg' 'pg-dev' 'bash' -c 'pwd'")

  await dockerExec.execute({ action: "reset" }, {} as never)
  const reverted = { args: { command: "pwd" } }
  await hooks["tool.execute.before"]!(beforeInput, reverted)
  assert.equal(reverted.args.command, "'docker' exec 'base' 'bash' -c 'pwd'")
})
