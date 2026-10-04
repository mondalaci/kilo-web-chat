export function relativeTime(timestamp?: number): string {
  if (!timestamp) return ""
  const delta = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return "just now"
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`
  if (delta < day) return `${Math.floor(delta / hour)}h ago`
  if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function formatTokens(value?: number): string {
  if (!value) return "0"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

export function formatCost(value?: number): string {
  if (!value) return "$0"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

/** A short human summary for a tool call, used in tool headers. */
export function toolSummary(tool: string, input: Record<string, unknown> | undefined): string {
  if (!input) return ""
  const value = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined)
  switch (tool) {
    case "bash":
      return value("command") ?? ""
    case "read":
    case "write":
    case "edit":
    case "patch":
      return value("filePath") ?? value("path") ?? ""
    case "glob":
    case "grep":
      return value("pattern") ?? ""
    case "webfetch":
      return value("url") ?? ""
    case "task":
      return value("description") ?? ""
    default: {
      const first = Object.values(input).find((item) => typeof item === "string")
      return (first as string) ?? ""
    }
  }
}