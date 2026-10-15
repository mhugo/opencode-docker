import assert from "node:assert/strict"
import test from "node:test"

import { parseConfig } from "../src/config.js"
import { buildDockerExec, ContainerResolver, type Runner } from "../src/docker.js"

test("builds a fully-quoted docker exec line", () => {
  const config = parseConfig({
    container: "dev",
    docker: "docker",
    shell: "bash",
    user: "root",
    workdir: "/work",
    env: { FOO: "bar baz" },
    execArgs: ["-i"],
  })

  assert.equal(
    buildDockerExec(config, "dev", "echo 'hi'"),
    "'docker' exec -i -u 'root' -w '/work' -e 'FOO=bar baz' 'dev' 'bash' -c 'echo '\\''hi'\\'''",
  )
})

test("builds a minimal docker exec line", () => {
  const config = parseConfig({ container: "dev" })
  assert.equal(buildDockerExec(config, "dev", "ls -la"), "'docker' exec 'dev' 'bash' -c 'ls -la'")
})

test("resolves an existing container without running anything", async () => {
  let calls = 0
  const runner: Runner = async () => {
    calls++
    return { stdout: "", stderr: "", exitCode: 0 }
  }
  const resolver = new ContainerResolver(runner)
  assert.equal(await resolver.resolve(parseConfig({ container: "dev" })), "dev")
  assert.equal(calls, 0)
})

test("creates a container from a command and caches the result", async () => {
  let calls = 0
  const runner: Runner = async () => {
    calls++
    return { stdout: "pulled image\nabc123def456\n", stderr: "", exitCode: 0 }
  }
  const resolver = new ContainerResolver(runner)
  const config = parseConfig({ command: "docker run -d alpine" })

  const [a, b] = await Promise.all([resolver.resolve(config), resolver.resolve(config)])
  assert.equal(a, "abc123def456")
  assert.equal(b, "abc123def456")
  assert.equal(await resolver.resolve(config), "abc123def456")
  assert.equal(calls, 1)
})

test("re-resolves and creates a new container when the command changes", async () => {
  const runner: Runner = async (command) => ({
    stdout: command.includes("second") ? "bbb\n" : "aaa\n",
    stderr: "",
    exitCode: 0,
  })
  const resolver = new ContainerResolver(runner)
  assert.equal(await resolver.resolve(parseConfig({ command: "docker run -d first" })), "aaa")
  assert.equal(await resolver.resolve(parseConfig({ command: "docker run -d second" })), "bbb")
})

test("runs the create command but targets the configured container when both are set", async () => {
  let calls = 0
  const runner: Runner = async () => {
    calls++
    return { stdout: "", stderr: "", exitCode: 0 }
  }
  const resolver = new ContainerResolver(runner)
  const config = parseConfig({ container: "named", command: "docker start named" })
  assert.equal(await resolver.resolve(config), "named")
  assert.equal(calls, 1)
})

test("throws when the create command fails", async () => {
  const runner: Runner = async () => ({ stdout: "", stderr: "boom", exitCode: 125 })
  const resolver = new ContainerResolver(runner)
  await assert.rejects(() => resolver.resolve(parseConfig({ command: "docker run broken" })), /exit 125.*boom/)
})

test("throws when the create command prints no container id", async () => {
  const runner: Runner = async () => ({ stdout: "\n\n", stderr: "", exitCode: 0 })
  const resolver = new ContainerResolver(runner)
  await assert.rejects(() => resolver.resolve(parseConfig({ command: "docker run -d alpine" })), /did not print/)
})

test("throws when neither container nor command is configured", async () => {
  const resolver = new ContainerResolver(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
  await assert.rejects(() => resolver.resolve(parseConfig({ dynamic: false })), /no container/)
})
