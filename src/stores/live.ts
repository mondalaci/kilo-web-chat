import { ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { BaseEvent, ServerEvent } from "@/api/types"
import { useChat } from "./chat"
import { useSessions } from "./sessions"

const live = ref(false)
const connecting = ref(false)
const lastEventAt = ref<number | null>(null)

let controller: AbortController | null = null
const seen = new Set<string>()

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function normalize(event: ServerEvent): { id?: string; type: string; properties?: Record<string, unknown> } | null {
  if ((event as { type?: string }).type === "sync") {
    const sync = (event as { syncEvent: { id: string; type: string; data: Record<string, unknown> } }).syncEvent
    if (!sync) return null
    return { id: sync.id, type: sync.type.replace(/\.1$/, ""), properties: sync.data }
  }
  const base = event as BaseEvent
  if (!base?.type) return null
  return { id: base.id, type: base.type.replace(/\.1$/, ""), properties: base.properties }
}

export function useLive() {
  const chat = useChat()
  const sessions = useSessions()

  function handle(event: ServerEvent) {
    const normalized = normalize(event)
    if (!normalized) return
    if (normalized.id) {
      if (seen.has(normalized.id)) return
      seen.add(normalized.id)
      if (seen.size > 4000) {
        // Bound memory; keeping the newest half is enough for dedupe.
        const keep = [...seen].slice(-2000)
        seen.clear()
        for (const id of keep) seen.add(id)
      }
    }
    lastEventAt.value = Date.now()
    sessions.applyEvent(normalized.type, normalized.properties)
    chat.applyEvent(normalized.type, normalized.properties)
  }

  async function resync(client: ServerClient, directory?: string) {
    try {
      await sessions.load(client, directory)
    } catch {
      /* ignore */
    }
    const currentID = sessions.currentID.value
    if (currentID) {
      try {
        await chat.open(client, currentID, directory)
      } catch {
        /* ignore */
      }
    }
  }

  async function start(client: ServerClient, directory?: string) {
    stop()
    controller = new AbortController()
    const signal = controller.signal
    connecting.value = true

    void (async () => {
      let first = true
      while (!signal.aborted) {
        try {
          await client.subscribe(
            handle,
            {
              directory,
              signal,
              onOpen: () => {
                live.value = true
                connecting.value = false
                void resync(client, directory)
              },
            },
          )
        } catch {
          /* connection dropped */
        }
        live.value = false
        if (signal.aborted) break
        if (!first) connecting.value = true
        first = false
        await sleep(1000, signal)
      }
    })()
  }

  function stop() {
    controller?.abort()
    controller = null
    live.value = false
    connecting.value = false
    seen.clear()
  }

  return { live, connecting, lastEventAt, start, stop }
}