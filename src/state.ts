import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { type DockerOverride, toOverride } from "./config.js"

/**
 * A JSON file that is re-read (mtime/size cached) before every shell call.
 *
 * Any field present in the file overrides the static configuration, which makes
 * it possible to switch the target container mid-session — either by editing the
 * file directly or through the `docker_exec` tool.
 */
export class StateStore {
  private mtimeMs = -1
  private size = -1
  private loaded = false
  private cached: DockerOverride = {}

  constructor(readonly file: string) {}

  async read(): Promise<DockerOverride> {
    try {
      const info = await stat(this.file)
      if (this.loaded && info.mtimeMs === this.mtimeMs && info.size === this.size) {
        return this.cached
      }
      const text = await readFile(this.file, "utf8")
      this.cached = toOverride(JSON.parse(text))
      this.mtimeMs = info.mtimeMs
      this.size = info.size
      this.loaded = true
      return this.cached
    } catch {
      this.cached = {}
      this.mtimeMs = -1
      this.size = -1
      this.loaded = true
      return this.cached
    }
  }

  async write(state: DockerOverride): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, `${JSON.stringify(state, null, 2)}\n`, "utf8")
    this.loaded = false
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true })
    this.loaded = false
  }
}
