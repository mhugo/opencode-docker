import { exec } from "node:child_process"
import { promisify } from "node:util"

import type { DockerExecConfig } from "./config.js"
import { shQuote } from "./quote.js"

const execAsync = promisify(exec)

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export type Runner = (command: string) => Promise<RunResult>

/**
 * Default runner backed by the system shell. Works on both Node and Bun
 * (opencode executes plugins with Bun, which implements `node:child_process`).
 */
export const defaultRunner: Runner = async (command) => {
  try {
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 16 * 1024 * 1024 })
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number | string }
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? (error instanceof Error ? error.message : String(error)),
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    }
  }
}

/**
 * Build the full `docker exec ...` command line that should replace the model's
 * original command. Every value is single-quoted so that the command survives
 * an extra round-trip through the host shell opencode uses to run the tool.
 */
export function buildDockerExec(config: DockerExecConfig, container: string, command: string): string {
  const parts: string[] = [shQuote(config.docker), "exec"]

  for (const arg of config.execArgs) parts.push(arg)
  if (config.user !== undefined) parts.push("-u", shQuote(config.user))
  if (config.workdir !== undefined) parts.push("-w", shQuote(config.workdir))
  for (const [key, value] of Object.entries(config.env)) parts.push("-e", shQuote(`${key}=${value}`))

  parts.push(shQuote(container), shQuote(config.shell), "-c", shQuote(command))
  return parts.join(" ")
}

/**
 * Lazily resolves the container to exec into, for a given (dynamic) config.
 *
 * - `container` only: used as-is.
 * - `command` only: run once, its last non-empty stdout line is the container ID.
 * - both: `command` is run once (to create/start the container) but `container`
 *   is used as the target, so the command does not need to print anything.
 *
 * Creation is memoised per `command`, so switching profiles mid-session reuses
 * an already-created container and only creates new ones for new commands.
 */
export class ContainerResolver {
  private readonly cache = new Map<string, Promise<string>>()

  constructor(private readonly runner: Runner = defaultRunner) {}

  async resolve(config: DockerExecConfig): Promise<string> {
    if (config.container) {
      if (config.command) await this.ensure(config.command, config.docker, false)
      return config.container
    }
    if (!config.command) {
      throw new Error("no container or container creation command configured")
    }
    return this.ensure(config.command, config.docker, true)
  }

  private ensure(command: string, docker: string, requireId: boolean): Promise<string> {
    const key = `${docker}\u0000${command}`
    let pending = this.cache.get(key)
    if (!pending) {
      pending = this.create(command, requireId).catch((error) => {
        this.cache.delete(key)
        throw error
      })
      this.cache.set(key, pending)
    }
    return pending
  }

  private async create(command: string, requireId: boolean): Promise<string> {
    const { stdout, stderr, exitCode } = await this.runner(command)
    if (exitCode !== 0) {
      throw new Error(`container creation command failed (exit ${exitCode}): ${stderr.trim() || command}`)
    }

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const id = lines.at(-1) ?? ""
    if (!id && requireId) {
      throw new Error(`container creation command did not print a container ID: ${command}`)
    }
    return id
  }
}
