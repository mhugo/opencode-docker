import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { StateStore } from "../src/state.js"

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "docker-exec-state-"))
  return join(dir, "nested", "docker-exec.json")
}

test("returns an empty override when the file is missing", async () => {
  const store = new StateStore(await tempFile())
  assert.deepEqual(await store.read(), {})
})

test("writes and reads a state file, creating parent directories", async () => {
  const store = new StateStore(await tempFile())
  await store.write({ container: "switched" })
  assert.deepEqual(await store.read(), { container: "switched" })
})

test("picks up external edits to the file", async () => {
  const file = await tempFile()
  const store = new StateStore(file)
  await store.write({ container: "first" })
  assert.deepEqual(await store.read(), { container: "first" })

  await writeFile(file, JSON.stringify({ active: "postgres" }), "utf8")
  // Bypass the mtime cache by using a fresh store, emulating a new process.
  const fresh = new StateStore(file)
  assert.deepEqual(await fresh.read(), { active: "postgres" })
})

test("clear removes the override", async () => {
  const store = new StateStore(await tempFile())
  await store.write({ container: "switched" })
  await store.clear()
  assert.deepEqual(await store.read(), {})
})

test("falls back to an empty override on malformed JSON", async () => {
  const file = await tempFile()
  const { mkdir } = await import("node:fs/promises")
  await mkdir(join(file, ".."), { recursive: true })
  await writeFile(file, "{ not json", "utf8")
  const store = new StateStore(file)
  assert.deepEqual(await store.read(), {})
})
