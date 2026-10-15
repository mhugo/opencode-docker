export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (typeof value === "string" && value.trim().length > 0) return value.trim().split(/\s+/)
  return []
}

export function asRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined && item !== null) out[key] = String(item)
    }
  }
  return out
}
