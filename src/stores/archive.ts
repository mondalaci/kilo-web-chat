import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import type { SessionInfo } from "@/api/types"

/**
 * Whether the archived-conversations view is showing in the sidebar.
 *
 * It lives here rather than in the component so the chat header can tell
 * whether the pane it sits over belongs to the archive.
 */
export const archiveOpen = ref(false)

const archived = ref<SessionInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/** When a conversation was archived; `updated` is a fallback for stale rows. */
function archivedAt(session: SessionInfo): number {
  return session.time?.archived ?? session.time?.updated ?? session.time?.created ?? 0
}

export function useArchive() {
  /** Archived conversations of the open project, newest archive first. */
  const sorted = computed(() => [...archived.value].sort((a, b) => archivedAt(b) - archivedAt(a)))

  /**
   * Read the project's archived conversations.
   *
   * They are usually few, so the page cap is a guard rather than a limit, and
   * the cursor carries its own direction: only the first page goes without one.
   */
  async function load(client: ServerClient, directory?: string | null) {
    loading.value = true
    error.value = null
    try {
      const all = new Map<string, SessionInfo>()
      let cursor: string | undefined
      for (let page = 0; page < 25; page++) {
        const result = await client.listSessions(directory, { archived: true, limit: 200, cursor })
        for (const session of result.data) {
          if (!session.parentID) all.set(session.id, session)
        }
        if (!result.next) break
        cursor = result.next
      }
      archived.value = [...all.values()]
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      archived.value = []
    } finally {
      loading.value = false
    }
  }

  function remove(sessionID: string) {
    archived.value = archived.value.filter((session) => session.id !== sessionID)
  }

  function reset() {
    archiveOpen.value = false
    archived.value = []
    loading.value = false
    error.value = null
  }

  return { open: archiveOpen, archived, sorted, loading, error, load, remove, reset }
}
