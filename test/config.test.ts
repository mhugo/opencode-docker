import assert from "node:assert/strict"
import test from "node:test"

import { applyOverride, parseConfig, resolveDynamicConfig, validateConfig } from "../src/config.js"

test("applies sensible defaults", () => {
  const config = parseConfig({ container: "dev" })
  assert.equal(config.container, "dev")
  assert.equal(config.docker, "docker")
  assert.equal(config.shell, "bash")
  assert.deepEqual(config.tools, ["bash", "shell"])
  assert.equal(config.enabled, true)
  assert.equal(config.dynamic, true)
})

test("options take precedence over environment variables", () => {
  const config = parseConfig(
    { container: "from-option" },
    { OPENCODE_DOCKER_CONTAINER: "from-env", OPENCODE_DOCKER_SHELL: "sh" },
  )
  assert.equal(config.container, "from-option")
  assert.equal(config.shell, "sh")
})

test("reads configuration from environment variables", () => {
  const config = parseConfig(undefined, {
    OPENCODE_DOCKER_COMMAND: "docker run -d alpine sleep infinity",
    OPENCODE_DOCKER_WORKDIR: "/work",
    OPENCODE_DOCKER_USER: "node",
    OPENCODE_DOCKER_STATE: ".opencode/custom.json",
  })
  assert.equal(config.command, "docker run -d alpine sleep infinity")
  assert.equal(config.workdir, "/work")
  assert.equal(config.user, "node")
  assert.equal(config.stateFile, ".opencode/custom.json")
})

test("normalises env maps and exec args", () => {
  const config = parseConfig({
    container: "dev",
    env: { FOO: "bar", NUM: 42, DROP: undefined },
    execArgs: ["-i", "-t"],
  })
  assert.deepEqual(config.env, { FOO: "bar", NUM: "42" })
  assert.deepEqual(config.execArgs, ["-i", "-t"])
})

test("accepts a single tool name or a list", () => {
  assert.deepEqual(parseConfig({ container: "d", tool: "bash" }).tools, ["bash"])
  assert.deepEqual(parseConfig({ container: "d", tools: ["bash", "fish"] }).tools, ["bash", "fish"])
})

test("parses named profiles", () => {
  const config = parseConfig({
    container: "default",
    profiles: {
      postgres: { container: "pg-dev", workdir: "/var/lib/postgresql" },
      app: { container: "app-dev", env: { NODE_ENV: "development" } },
    },
  })
  assert.equal(config.profiles.postgres?.container, "pg-dev")
  assert.equal(config.profiles.postgres?.workdir, "/var/lib/postgresql")
  assert.deepEqual(config.profiles.app?.env, { NODE_ENV: "development" })
})

test("validateConfig allows dynamic mode without a base target", () => {
  assert.equal(validateConfig(parseConfig({ container: "d" })), undefined)
  assert.equal(validateConfig(parseConfig({ command: "docker run -d x" })), undefined)
  assert.equal(validateConfig(parseConfig({})), undefined)
  assert.match(validateConfig(parseConfig({ dynamic: false })) ?? "", /either 'container'/)
})

test("applyOverride only touches present fields", () => {
  const base = parseConfig({ container: "base", workdir: "/base", env: { A: "1" } })
  const next = applyOverride(base, { container: "override", env: { B: "2" } })
  assert.equal(next.container, "override")
  assert.equal(next.workdir, "/base")
  assert.deepEqual(next.env, { A: "1", B: "2" })
})

test("applyOverride can clear a field with null", () => {
  const base = parseConfig({ container: "base", command: "docker run -d x" })
  const next = applyOverride(base, { container: null })
  assert.equal(next.container, undefined)
  assert.equal(next.command, "docker run -d x")
})

test("resolveDynamicConfig layers profile then direct state fields", () => {
  const base = parseConfig({
    container: "default",
    workdir: "/default",
    profiles: { app: { container: "app-dev", workdir: "/app" } },
  })

  const fromProfile = resolveDynamicConfig(base, { active: "app" })
  assert.equal(fromProfile.container, "app-dev")
  assert.equal(fromProfile.workdir, "/app")

  const overridden = resolveDynamicConfig(base, { active: "app", container: "explicit", workdir: null })
  assert.equal(overridden.container, "explicit")
  assert.equal(overridden.workdir, undefined)
})

test("resolveDynamicConfig ignores unknown profiles", () => {
  const base = parseConfig({ container: "default" })
  const effective = resolveDynamicConfig(base, { active: "missing" })
  assert.equal(effective.container, "default")
})
