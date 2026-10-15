import { asRecord, asString, asStringArray } from "./util.js"

/**
 * A partial set of overrides. Used both for named `profiles` in the static
 * config and for the dynamic state file. A `null` value explicitly clears a
 * field inherited from a lower layer (e.g. `"container": null` forces the
 * creation `command` to be used instead of the default container).
 */
export interface DockerOverride {
  active?: string | null
  container?: string | null
  command?: string | null
  docker?: string | null
  shell?: string | null
  workdir?: string | null
  user?: string | null
  env?: Record<string, string>
  execArgs?: string[]
}

export type DockerProfile = DockerOverride

export interface DockerExecConfig {
  /** Existing container name or ID to exec into. */
  container?: string
  /** Shell command that creates/starts a container and prints its ID as the last line. */
  command?: string
  /** Optional command run when the plugin is disposed (e.g. `docker rm -f ...`). */
  cleanupCommand?: string
  /** Container engine binary. Defaults to `docker` (use `podman` for rootless setups). */
  docker: string
  /** Shell used inside the container. Defaults to `bash`. */
  shell: string
  /** Working directory inside the container (`docker exec -w`). */
  workdir?: string
  /** User to run as inside the container (`docker exec -u`). */
  user?: string
  /** Extra environment variables passed to the container (`docker exec -e`). */
  env: Record<string, string>
  /** Raw extra flags inserted into `docker exec`, e.g. `["-i", "-t"]`. */
  execArgs: string[]
  /** Tool name(s) whose `command` argument should be redirected. Defaults to `["bash", "shell"]`. */
  tools: string[]
  /** Named alternative targets selectable at runtime. */
  profiles: Record<string, DockerProfile>
  /** Path (relative to the project worktree) of the dynamic override file. */
  stateFile?: string
  /** When true, the state file is re-read on every shell call. Defaults to true. */
  dynamic: boolean
  /** Register TUI slash commands for switching targets. Defaults to true. */
  commands: boolean
  /** Prefix used for the generated TUI commands. Defaults to `docker`. */
  commandPrefix: string
  /** Set to `false` to disable the plugin without removing its config. */
  enabled: boolean
}

export type Env = Record<string, string | undefined>

function parseOverride(value: unknown): DockerOverride {
  const out: DockerOverride = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return out
  const raw = value as Record<string, unknown>

  for (const key of ["active", "container", "command", "docker", "shell", "workdir", "user"] as const) {
    if (!(key in raw)) continue
    const item = raw[key]
    if (item === null) {
      out[key] = null
    } else {
      const str = asString(item)
      if (str !== undefined) out[key] = str
    }
  }
  if ("env" in raw) out.env = asRecord(raw.env)
  if ("execArgs" in raw) out.execArgs = asStringArray(raw.execArgs)
  return out
}

function parseProfiles(value: unknown): Record<string, DockerProfile> {
  const out: Record<string, DockerProfile> = {}
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [name, profile] of Object.entries(value as Record<string, unknown>)) {
      out[name] = parseOverride(profile)
    }
  }
  return out
}

/** Extract the subset of override keys that are present on an arbitrary object. */
export function toOverride(value: unknown): DockerOverride {
  return parseOverride(value)
}

/**
 * Normalise plugin options (from the `["plugin-name", { ... }]` tuple form) and
 * environment variables into a fully-populated {@link DockerExecConfig}.
 *
 * Options win over environment variables. Environment variables make it possible
 * to configure the plugin without editing `opencode.json` (useful for CI images).
 */
export function parseConfig(options: Record<string, unknown> | undefined, env: Env = {}): DockerExecConfig {
  const opts = options ?? {}

  const container = asString(opts.container) ?? asString(env.OPENCODE_DOCKER_CONTAINER)
  const command = asString(opts.command) ?? asString(env.OPENCODE_DOCKER_COMMAND)
  const cleanupCommand =
    asString(opts.cleanupCommand) ?? asString(opts.cleanup) ?? asString(env.OPENCODE_DOCKER_CLEANUP)

  const tools = new Set<string>(asStringArray(opts.tools))
  const singleTool = asString(opts.tool)
  if (singleTool) tools.add(singleTool)
  if (tools.size === 0) {
    tools.add("bash")
    tools.add("shell")
  }

  return {
    container,
    command,
    cleanupCommand,
    docker: asString(opts.docker) ?? asString(env.OPENCODE_DOCKER_BIN) ?? "docker",
    shell: asString(opts.shell) ?? asString(env.OPENCODE_DOCKER_SHELL) ?? "bash",
    workdir: asString(opts.workdir) ?? asString(env.OPENCODE_DOCKER_WORKDIR),
    user: asString(opts.user) ?? asString(env.OPENCODE_DOCKER_USER),
    env: asRecord(opts.env),
    execArgs: asStringArray(opts.execArgs),
    tools: [...tools],
    profiles: parseProfiles(opts.profiles),
    stateFile: asString(opts.stateFile) ?? asString(env.OPENCODE_DOCKER_STATE),
    dynamic: opts.dynamic !== false,
    commands: opts.commands !== false,
    commandPrefix: asString(opts.commandPrefix) ?? asString(env.OPENCODE_DOCKER_COMMAND_PREFIX) ?? "docker",
    enabled: opts.enabled !== false,
  }
}

/** Apply a single override layer on top of a config, returning a new object. */
export function applyOverride(base: DockerExecConfig, override: DockerOverride | undefined): DockerExecConfig {
  if (!override) return base
  const next: DockerExecConfig = { ...base }

  if ("container" in override) next.container = override.container ?? undefined
  if ("command" in override) next.command = override.command ?? undefined
  if ("docker" in override) next.docker = override.docker ?? base.docker
  if ("shell" in override) next.shell = override.shell ?? base.shell
  if ("workdir" in override) next.workdir = override.workdir ?? undefined
  if ("user" in override) next.user = override.user ?? undefined
  if ("env" in override && override.env) next.env = { ...base.env, ...override.env }
  if ("execArgs" in override && override.execArgs) next.execArgs = override.execArgs

  return next
}

/**
 * Compute the effective config for the current call: start from the static
 * config, apply the profile named by `state.active` (if any), then apply the
 * state file's own direct fields.
 */
export function resolveDynamicConfig(base: DockerExecConfig, state: DockerOverride | undefined): DockerExecConfig {
  let config = base
  if (state?.active) {
    const profile = base.profiles[state.active]
    if (profile) config = applyOverride(config, profile)
  }
  return applyOverride(config, state)
}

/** Returns a human-readable problem description, or `undefined` when the config is usable. */
export function validateConfig(config: DockerExecConfig): string | undefined {
  if (config.container || config.command) return undefined
  if (config.dynamic) return undefined
  return "either 'container' or 'command' must be set (or enable 'dynamic' with a state file)"
}
