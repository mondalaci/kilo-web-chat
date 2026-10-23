import type { Credentials } from "./client"
import { DEFAULT_USERNAME } from "./client"

export type ServerProduct = "opencode" | "unknown"

export interface InstanceInfo {
  id: string
  origin: string
  product: ServerProduct
  version: string
  /** Default directory reported by `/api/location`, when reachable. */
  directory?: string
  requiresAuth: boolean
}

export interface DiscoverOptions {
  /** Origins or host:port strings to probe in addition to the defaults. */
  candidates?: string[]
  credentialsFor?: (origin: string) => Credentials | undefined
  timeoutMs?: number
}

/**
 * Default ports to probe. opencode v2 picks a random free port unless it is
 * pinned, so deployments (including the bundled PM2 one, see
 * `~/.config/opencode/ecosystem.config.cjs`) usually pin `4097`; the rest of the
 * list covers the documented default and a few common dev ports.
 */
export const DEFAULT_PORTS = [
  4097, 4096, 4098, 4099, 4100, 4101, 4102, 4103, 4104, 4105, 4110, 4120,
  3000, 3456, 5000, 8000, 8080,
]

/** The port assumed when a user enters a bare host name. */
export const FALLBACK_PORT = "4097"

const DEFAULT_HOSTS = ["localhost"]

/** Hosts that refer to the same loopback server and are shown as `localhost`. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"])

/**
 * Normalize a user-entered address into an origin such as `http://localhost:4097`.
 * Loopback aliases (`127.0.0.1`, `::1`, `0.0.0.0`) are canonicalized to
 * `localhost` so the same server is not listed more than once.
 */
export function normalizeOrigin(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (!url.port) url.port = FALLBACK_PORT
    if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) url.hostname = "localhost"
    if (url.pathname !== "/") url.pathname = "/"
    return url.origin
  } catch {
    return null
  }
}

interface InfoResponse {
  version?: string
  pid?: number
  urls?: string[]
  paths?: Record<string, string>
  capabilities?: Record<string, unknown>
}

interface LocationResponse {
  directory?: string
}

function authHeader(credentials?: Credentials): Record<string, string> {
  if (!credentials?.password) return {}
  const username = credentials.username || DEFAULT_USERNAME
  return { Authorization: `Basic ${btoa(`${username}:${credentials.password}`)}` }
}

/**
 * Probe a single origin for an opencode v2 server.
 *
 * Detection uses `GET /api/info`, which every v2 server exposes and which
 * answers 401 (rather than 404) when a password is set — that is how an origin
 * is reported as *password required*. Returns `null` for anything else: an
 * older Kilo/opencode v1 server answers 404 there, and the v2 SPA fallback
 * replies with HTML, which fails the JSON shape check.
 */
export async function probeInstance(
  input: string,
  credentials?: Credentials,
  timeoutMs = 1200,
): Promise<InstanceInfo | null> {
  const origin = normalizeOrigin(input)
  if (!origin) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = authHeader(credentials)
  try {
    const res = await fetch(`${origin}/api/info`, { headers, signal: controller.signal })
    if (res.status === 401) {
      return { id: origin, origin, product: "unknown", version: "unknown", requiresAuth: true }
    }
    if (!res.ok) return null

    const type = res.headers.get("content-type") ?? ""
    if (!type.includes("json")) return null
    const info = (await res.json().catch(() => null)) as InfoResponse | null
    if (!info || typeof info.version !== "string") return null
    // Require a hallmark of the v2 info payload so the SPA's HTML shell (which
    // some proxies return with 200) cannot be mistaken for a server.
    if (typeof info.pid !== "number" && !info.capabilities) return null

    let directory: string | undefined
    try {
      const locationRes = await fetch(`${origin}/api/location`, { headers, signal: controller.signal })
      if (locationRes.ok) directory = ((await locationRes.json()) as LocationResponse)?.directory
    } catch {
      /* /api/location is best-effort */
    }

    return {
      id: origin,
      origin,
      product: "opencode",
      version: info.version,
      directory,
      requiresAuth: false,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Probe many origins with bounded concurrency. */
export async function discoverInstances(opts: DiscoverOptions = {}): Promise<InstanceInfo[]> {
  const timeoutMs = opts.timeoutMs ?? 1200
  const candidates = new Set<string>()

  for (const port of DEFAULT_PORTS) for (const host of DEFAULT_HOSTS) {
    const origin = normalizeOrigin(`${host}:${port}`)
    if (origin) candidates.add(origin)
  }
  for (const candidate of opts.candidates ?? []) {
    const origin = normalizeOrigin(candidate)
    if (origin) candidates.add(origin)
  }

  const list = [...candidates]
  const results: InstanceInfo[] = []
  const seen = new Set<string>()
  const concurrency = 16

  let cursor = 0
  async function worker() {
    while (cursor < list.length) {
      const candidate = list[cursor++]
      const origin = normalizeOrigin(candidate)
      if (!origin) continue
      const info = await probeInstance(candidate, opts.credentialsFor?.(origin), timeoutMs)
      if (info && !seen.has(info.origin)) {
        seen.add(info.origin)
        results.push(info)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
  return results.sort((a, b) => {
    if (a.requiresAuth !== b.requiresAuth) return a.requiresAuth ? 1 : -1
    return DEFAULT_PORTS.indexOf(Number(new URL(a.origin).port)) - DEFAULT_PORTS.indexOf(Number(new URL(b.origin).port))
  })
}
