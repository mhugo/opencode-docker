import { resolve as resolvePath } from "node:path"

import { tool, type Hooks, type Plugin, type PluginInput } from "@opencode-ai/plugin"

import { parseConfig, resolveDynamicConfig, validateConfig, type DockerExecConfig } from "./config.js"
import { buildCommands } from "./commands.js"
import { buildDockerExec, ContainerResolver, defaultRunner } from "./docker.js"
import { shQuote } from "./quote.js"
import { StateStore } from "./state.js"

// NOTE: opencode invokes every function export of the plugin entry module as a
// plugin factory. Keep this module free of any other exports; helper utilities
// are exposed through package subpaths (see package.json "exports").
const DEFAULT_STATE_FILE = ".opencode/docker-exec.json"

type LogLevel = "debug" | "info" | "warn" | "error"

async function log(input: PluginInput, level: LogLevel, message: string, extra?: Record<string, unknown>) {
  try {
    await (input.client as any).app?.log?.({
      body: { service: "opencode-docker-exec", level, message, extra },
    })
  } catch {
    console.error(`[opencode-docker-exec] ${message}${extra ? ` ${JSON.stringify(extra)}` : ""}`)
  }
}

function targetLabel(config: DockerExecConfig): string {
  if (config.container) return `container ${config.container}`
  if (config.command) return `created on demand via: ${config.command}`
  return "(none configured)"
}

/**
 * Plugin that transparently redirects the model's shell tool calls into a Docker
 * container. It rewrites `output.args.command` in `tool.execute.before`, so all
 * of opencode's native shell behaviour (timeout, background jobs, output
 * truncation, permission prompts) is preserved — only the execution target
 * changes.
 *
 * When `dynamic` is enabled (the default), the target is re-resolved on every
 * call from a small JSON state file, so it can be changed mid-session — either
 * by editing the file or via the generated `docker_exec` tool.
 */
export const DockerExecPlugin: Plugin = async (input, options) => {
  const config = parseConfig(options as Record<string, unknown> | undefined, process.env)
  const toolSet = new Set(config.tools)

  if (!config.enabled) {
    await log(input, "info", "disabled")
    return {}
  }

  const problem = validateConfig(config)
  if (problem) {
    await log(input, "error", `inactive: ${problem}`)
    return {}
  }

  const resolver = new ContainerResolver(defaultRunner)
  const stateFile = resolvePath(input.worktree || input.directory, config.stateFile ?? DEFAULT_STATE_FILE)
  const store = new StateStore(stateFile)

  await log(input, "info", "active", {
    container: config.container,
    command: config.command,
    tools: config.tools,
    docker: config.docker,
    dynamic: config.dynamic,
    stateFile: config.dynamic ? stateFile : undefined,
    profiles: Object.keys(config.profiles),
  })

  const hooks: Hooks = {
    config: async (cfg) => {
      if (!config.commands) return
      cfg.command = { ...(cfg.command ?? {}), ...buildCommands(config) }
    },

    "tool.execute.before": async (toolInput, output) => {
      if (!toolSet.has(toolInput.tool)) return
      const args = output.args as { command?: unknown } | undefined
      if (!args || typeof args.command !== "string") return

      const state = config.dynamic ? await store.read() : undefined
      const effective = resolveDynamicConfig(config, state)
      const container = await resolver.resolve(effective)
      args.command = buildDockerExec(effective, container, args.command)
    },

    dispose: async () => {
      if (!config.cleanupCommand) return
      const result = await defaultRunner(config.cleanupCommand)
      if (result.exitCode !== 0) {
        await log(input, "error", `cleanup command failed (exit ${result.exitCode})`, {
          stderr: result.stderr.trim(),
        })
      }
    },
  }

  if (config.dynamic) {
    hooks.tool = {
      docker_exec: tool({
        description:
          "Manage which Docker container opencode shell commands run in. " +
          "Use action 'status' to see the current target, 'list' to list running " +
          "containers, 'use' with a profile name, 'set' with a container name or ID, " +
          "or 'reset' to return to the configured default.",
        args: {
          action: tool.schema
            .enum(["status", "list", "use", "set", "reset"])
            .describe("The operation to perform"),
          target: tool.schema
            .string()
            .optional()
            .describe("Profile name for 'use', or container name/ID for 'set'"),
        },
        async execute(args) {
          const state = await store.read()

          switch (args.action) {
            case "status": {
              const effective = resolveDynamicConfig(config, state)
              return [
                `Dynamic configuration: ${config.dynamic ? "enabled" : "disabled"}`,
                `State file: ${stateFile}`,
                `Active profile: ${state.active ?? "(none)"}`,
                `Effective target: ${targetLabel(effective)}`,
                `Profiles: ${Object.keys(config.profiles).join(", ") || "(none)"}`,
              ].join("\n")
            }
            case "list": {
              const result = await defaultRunner(
                `${shQuote(config.docker)} ps --format ${shQuote("{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}")}`,
              )
              if (result.exitCode !== 0) return `${config.docker} ps failed: ${result.stderr.trim()}`
              return result.stdout.trim() || "(no running containers)"
            }
            case "use": {
              if (!args.target) return "error: 'use' requires a profile name"
              if (!config.profiles[args.target]) {
                return `error: unknown profile '${args.target}'. Available: ${Object.keys(config.profiles).join(", ") || "(none)"}`
              }
              await store.write({ active: args.target })
              const effective = resolveDynamicConfig(config, { active: args.target })
              return `Switched to profile '${args.target}' (${targetLabel(effective)}).`
            }
            case "set": {
              if (!args.target) return "error: 'set' requires a container name or ID"
              await store.write({ active: null, container: args.target })
              return `Shell commands will now run in container '${args.target}'.`
            }
            case "reset": {
              await store.clear()
              return "Reverted to the configured default target."
            }
            default:
              return `error: unknown action '${args.action}'`
          }
        },
      }),
    }
  }

  return hooks
}
