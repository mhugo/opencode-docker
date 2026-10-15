import assert from "node:assert/strict"
import test from "node:test"

import { buildCommands } from "../src/commands.js"
import { parseConfig } from "../src/config.js"

test("builds a general command plus one per profile", () => {
  const commands = buildCommands(
    parseConfig({
      container: "base",
      profiles: { app: { container: "app-dev" }, postgres: { container: "pg-dev" } },
    }),
  )
  assert.deepEqual(Object.keys(commands).sort(), ["docker", "docker-app", "docker-postgres"])
  assert.match(commands.docker!.template, /docker_exec tool/)
  assert.match(commands.docker!.template, /\$ARGUMENTS/)
  assert.match(commands.docker!.template, /app, postgres/)
  assert.match(commands["docker-postgres"]!.template, /action "use" and target "postgres"/)
})

test("honours a custom command prefix", () => {
  const commands = buildCommands(parseConfig({ container: "base", commandPrefix: "container" }))
  assert.ok(commands.container)
  assert.equal(commands.docker, undefined)
})

test("returns no commands when disabled", () => {
  assert.deepEqual(buildCommands(parseConfig({ container: "base", commands: false })), {})
})
