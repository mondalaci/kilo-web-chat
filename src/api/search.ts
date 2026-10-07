/**
 * Client for the local `kilo-search` FTS5/BM25 content-search service.
 * Falls back cleanly when the service is not running.
 */

export interface ContentHit {
  sessionID: string
  title: string
  directory: string
  updated: number
  score?: number
  snippet?: string
}

const KEY = "kilo-web-chat.search-url"
const DEFAULT_URL = "http://127.0.0.1:27184"

export function searchURL(): string {
  return localStorage.getItem(KEY)?.trim() || DEFAULT_URL
}

export function setSearchURL(url: string) {
  const value = url.trim()
  if (value) localStorage.setItem(KEY, value)
  else localStorage.removeItem(KEY)
}

/** Query the content-search service; throws if it is unreachable or errors. */
export async function searchContent(query: string, limit = 30): Promise<ContentHit[]> {
  const url = new URL("/search", searchURL())
  url.searchParams.set("q", query)
  url.searchParams.set("limit", String(limit))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`search failed: ${res.status}`)
    const data = (await res.json()) as { results?: ContentHit[] }
    return data.results ?? []
  } finally {
    clearTimeout(timer)
  }
}

/** Whether the content-search service is reachable. */
export async function searchReachable(timeout = 1500): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(new URL("/health", searchURL()), { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export interface SearchHealth {
  ok: boolean
  parts: number
  sessions: number
}

export async function searchHealth(timeout = 1500): Promise<SearchHealth | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(new URL("/health", searchURL()), { signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as SearchHealth
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** List all conversations (newest first) from the content-search service. */
export async function listAllSessions(limit = 5000): Promise<ContentHit[]> {
  const url = new URL("/sessions", searchURL())
  url.searchParams.set("limit", String(limit))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`list failed: ${res.status}`)
    const data = (await res.json()) as { results?: ContentHit[] }
    return data.results ?? []
  } finally {
    clearTimeout(timer)
  }
}
