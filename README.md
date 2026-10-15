# opencode-docker-exec

An [opencode](https://opencode.ai) plugin that runs the model's shell commands
inside an existing Docker container instead of on your host machine.

The plugin transparently rewrites every shell call (`bash`/`shell`) to
`docker exec …`, so you keep all of opencode's native behaviour — timeouts,
background jobs, output truncation and permission prompts — and only change
*where* the command runs.

```
model:  ls -la
        ↓  plugin rewrites
runs:   docker exec -w '/work' 'my-container' 'bash' -c 'ls -la'
```

## Requirements

- opencode (plugin API `@opencode-ai/plugin` >= 1.0.0)
- Docker (or Podman) reachable from the machine running opencode

## Installation

### From npm

Add the plugin to the `plugin` array in your `opencode.json`. opencode installs
npm plugins automatically with Bun at startup:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-docker-exec", { "container": "my-container" }]
  ]
}
```

### From a local checkout

Build the plugin, then point opencode at the entry file (paths are relative to
the config that declares them):

```bash
npm install
npm run build
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["./path/to/opencode-docker-exec/dist/index.js", { "container": "my-container" }]
  ]
}
```

You can also point directly at the TypeScript source (`./src/index.ts`) if you
prefer not to build.

> **Restart opencode after changing the config.** Configuration and plugins are
> loaded once at startup and are not hot-reloaded.

## Configuration

The plugin is configured through the options object of the `plugin` tuple (or
via environment variables, see below). You must set **either** `container` or
`command` — unless dynamic configuration is used, in which case the target can
be supplied at runtime.

| Key              | Type                          | Default                        | Description |
| ---------------- | ----------------------------- | ------------------------------ | ----------- |
| `container`      | `string`                      | —                              | Name or ID of an existing container to exec into. |
| `command`        | `string`                      | —                              | Shell command that creates/starts a container and prints its ID as the last line of stdout (e.g. `docker run -d …`). Run once, lazily, on the first shell call. |
| `cleanupCommand` | `string`                      | —                              | Command run when the plugin is disposed (e.g. `docker rm -f <name>`). Alias: `cleanup`. |
| `docker`         | `string`                      | `"docker"`                     | Container engine binary (use `"podman"` for rootless setups). |
| `shell`          | `string`                      | `"bash"`                       | Shell used inside the container. |
| `workdir`        | `string`                      | —                              | Working directory inside the container (`docker exec -w`). |
| `user`           | `string`                      | —                              | User to run as inside the container (`docker exec -u`). |
| `env`            | `Record<string,string>`       | `{}`                           | Extra environment variables for the container (`docker exec -e K=V`). |
| `execArgs`       | `string[]`                    | `[]`                           | Raw extra flags inserted into `docker exec`, e.g. `["-i", "-t"]`. |
| `tool`           | `string`                      | —                              | A single tool name to redirect. |
| `tools`          | `string[]`                    | `["bash","shell"]`             | Tool names whose `command` argument is redirected. |
| `profiles`       | `Record<string, Profile>`     | `{}`                           | Named alternative targets selectable at runtime (see [Dynamic configuration](#dynamic-configuration)). |
| `stateFile`      | `string`                      | `".opencode/docker-exec.json"` | Path (relative to the project worktree) of the dynamic override file. |
| `dynamic`        | `boolean`                     | `true`                         | Re-read the state file before every shell call, and expose the `docker_exec` tool. |
| `enabled`        | `boolean`                     | `true`                         | Set to `false` to disable the plugin without removing its config. |

### Existing container

```json
{
  "plugin": [
    ["opencode-docker-exec", {
      "container": "my-project-dev",
      "workdir": "/workspace",
      "env": { "NODE_ENV": "development" }
    }]
  ]
}
```

If the container is stopped, start it yourself (`docker start my-project-dev`)
before running opencode.

### Creating the container on demand

Set `command` to a command that creates the container and prints its ID. The
plugin runs it once, lazily, on the first shell call and caches the result:

```json
{
  "plugin": [
    ["opencode-docker-exec", {
      "command": "docker run -d --rm -v \"$PWD\":/work -w /work alpine sleep infinity",
      "cleanup": "docker rm -f $OPENCODE_DOCKER_CONTAINER",
      "shell": "sh"
    }]
  ]
}
```

When both `container` and `command` are set, `command` is still run once (to
create/start the container), but `container` is used as the exec target — so the
command does not need to print anything:

```json
{
  "plugin": [
    ["opencode-docker-exec", {
      "container": "my-project-dev",
      "command": "docker start my-project-dev || docker run -d --name my-project-dev alpine sleep infinity",
      "shell": "sh"
    }]
  ]
}
```

### Podman

```json
{
  "plugin": [
    ["opencode-docker-exec", { "container": "dev", "docker": "podman" }]
  ]
}
```

## Dynamic configuration

By default the plugin re-resolves the target **before every shell call** from a
small JSON state file (`.opencode/docker-exec.json` relative to the project
worktree). That means you can switch which container the model talks to without
restarting opencode.

The state file may contain any of the executable options (`container`,
`command`, `docker`, `shell`, `workdir`, `user`, `env`, `execArgs`) plus an
`active` field naming one of the configured `profiles`. Direct fields win over
the active profile, which wins over the static config. A `null` value clears an
inherited field.

### Profiles

Define reusable targets in `opencode.json`:

```json
{
  "plugin": [
    ["opencode-docker-exec", {
      "container": "app-dev",
      "profiles": {
        "app": { "container": "app-dev", "workdir": "/workspace" },
        "postgres": { "container": "pg-dev", "workdir": "/var/lib/postgresql" },
        "legacy": { "command": "docker run -d --rm legacy-image sleep infinity", "shell": "sh" }
      }
    }]
  ]
}
```

### Switching mid-session

Ask the model to switch — it has a `docker_exec` tool:

> "Switch to the postgres profile." · "Run the next commands in container `build-42`." · "Which container are you using?" · "Reset to the default."

The tool accepts an `action`:

| Action   | Target                         | Effect |
| -------- | ------------------------------ | ------ |
| `status` | —                              | Reports the current target, active profile and available profiles. |
| `list`   | —                              | Runs `docker ps` and lists running containers. |
| `use`    | a profile name                 | Writes `{ "active": "<name>" }` to the state file. |
| `set`    | a container name or ID         | Writes `{ "container": "<name>" }` to the state file. |
| `reset`  | —                              | Deletes the state file, reverting to the static config. |

### Switching without the model

You can also edit the state file yourself — the plugin picks up changes on the
next command via the file's mtime:

```jsonc
// .opencode/docker-exec.json
{ "active": "postgres" }
```

```jsonc
// switch to a raw container
{ "container": "build-42" }
```

```jsonc
// switch profile but override the working directory
{ "active": "app", "workdir": "/srv" }
```

To disable all of this, set `"dynamic": false`; the target is then resolved once
from the static config and the `docker_exec` tool is not registered.

## Environment variables

Any option can be supplied through the environment instead of the config object.
Options take precedence over environment variables.

| Variable                     | Equivalent option |
| ---------------------------- | ----------------- |
| `OPENCODE_DOCKER_CONTAINER`  | `container`       |
| `OPENCODE_DOCKER_COMMAND`    | `command`         |
| `OPENCODE_DOCKER_CLEANUP`    | `cleanupCommand`  |
| `OPENCODE_DOCKER_BIN`        | `docker`          |
| `OPENCODE_DOCKER_SHELL`      | `shell`           |
| `OPENCODE_DOCKER_WORKDIR`    | `workdir`         |
| `OPENCODE_DOCKER_USER`       | `user`            |
| `OPENCODE_DOCKER_STATE`      | `stateFile`       |

Environment variables are convenient for CI images where editing
`opencode.json` is undesirable.

## How it works

The plugin registers a `tool.execute.before` hook. For every configured tool
whose arguments contain a `command` string, it:

1. computes the effective config (static config + active profile + state file),
2. resolves the target container (existing name/ID, or creates one from
   `command` and caches it per command), and
3. rewrites `output.args.command` to
   `docker exec [flags] <container> <shell> -c '<command>'`.

Every value is single-quoted before being embedded, so commands containing
spaces, quotes, pipes, redirections or newlines are passed through unchanged.

## Limitations

- **Exec target is the container's filesystem.** Host paths (including the
  `workdir` argument some models pass to the shell tool) do not map to the
  container automatically. Set the container working directory with the
  `workdir` option and/or mount volumes in the `command`.
- **Permissions are matched against the rewritten command.** Because the
  command is rewritten before execution, `permission.bash` patterns are
  evaluated against the `docker exec …` wrapper rather than your original
  command. Prefer a broad `"bash": "ask"`/`"allow"` rule when using this plugin.
- The container image must contain the chosen `shell` (`bash` by default;
  use `"shell": "sh"` for minimal images such as `alpine`).
- **The dynamic state file is shared by all sessions** running against the same
  project — switching the target affects every opencode session in that
  worktree, not just the current one.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test via tsx
npm run build       # emits dist/ (JS + .d.ts)
```

## License

MIT
