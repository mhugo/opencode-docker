import type { DockerExecConfig } from "./config.js"

export interface CommandDefinition {
  template: string
  description: string
}

/**
 * Build the TUI slash commands that the plugin injects into the config.
 *
 * opencode exposes custom commands in the TUI command palette (the `/` menu).
 * The generated commands delegate to the `docker_exec` tool, so switching is
 * available both from the palette and from natural language.
 */
export function buildCommands(config: DockerExecConfig): Record<string, CommandDefinition> {
  if (!config.commands) return {}

  const prefix = config.commandPrefix
  const profiles = Object.keys(config.profiles)
  const commands: Record<string, CommandDefinition> = {}

  const profileHint = profiles.length
    ? `If it matches one of the configured profiles (${profiles.join(", ")}), use action "use".`
    : "There are no configured profiles."

  commands[prefix] = {
    description: "Switch the Docker container that opencode shell commands run in",
    template: [
      "Manage the Docker container that opencode runs shell commands in by calling the docker_exec tool.",
      '- If no argument is given below, call it with action "status".',
      `- ${profileHint}`,
      '- Otherwise call it with action "set" and the argument as the container name or ID.',
      "",
      "Argument: $ARGUMENTS",
    ].join("\n"),
  }

  for (const name of profiles) {
    commands[`${prefix}-${name}`] = {
      description: `Run opencode shell commands in the '${name}' Docker profile`,
      template: `Call the docker_exec tool with action "use" and target "${name}", then confirm the switch in one sentence.`,
    }
  }

  return commands
}
