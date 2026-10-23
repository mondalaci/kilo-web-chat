<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import { Archive, ArchiveRestore, Trash2, X } from "lucide-vue-next"
import Spinner from "./Spinner.vue"
import type { SessionInfo } from "@/api/types"
import { useApp } from "@/stores/app"
import { relativeTime } from "@/utils/format"

const app = useApp()
const { archived, sorted, loading, error } = app.archive

const query = ref("")
const inputEl = ref<HTMLInputElement | null>(null)
const restoring = ref<Set<string>>(new Set())
const deleting = ref<Set<string>>(new Set())
const confirming = ref<string | null>(null)
const actionError = ref<string | null>(null)

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return sorted.value
  return sorted.value.filter((session) => (session.title || "Untitled").toLowerCase().includes(needle))
})

function archivedLabel(session: SessionInfo) {
  const stamp = session.time?.archived ?? session.time?.updated
  return stamp ? `archived ${relativeTime(stamp)}` : "archived"
}

function isActive(sessionID: string) {
  return app.sessions.currentID.value === sessionID
}

function view(session: SessionInfo) {
  if (confirming.value === session.id) return
  void app.viewArchivedSession(session)
}

async function restore(session: SessionInfo) {
  if (restoring.value.has(session.id)) return
  actionError.value = null
  restoring.value = new Set(restoring.value).add(session.id)
  try {
    await app.restoreSession(session.id)
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    const next = new Set(restoring.value)
    next.delete(session.id)
    restoring.value = next
  }
}

/** Deleting is permanent, so the row has to be asked twice. */
function askDelete(sessionID: string) {
  actionError.value = null
  confirming.value = sessionID
}

async function remove(session: SessionInfo) {
  if (deleting.value.has(session.id)) return
  actionError.value = null
  deleting.value = new Set(deleting.value).add(session.id)
  try {
    await app.deleteSession(session.id)
    confirming.value = null
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    const next = new Set(deleting.value)
    next.delete(session.id)
    deleting.value = next
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return
  event.preventDefault()
  if (confirming.value) {
    confirming.value = null
    return
  }
  app.closeArchive()
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown)
  void nextTick(() => inputEl.value?.focus())
})

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown))
</script>

<template>
  <div class="archive" role="region" aria-label="Archived conversations">
    <header class="head">
      <span class="title"><Archive :size="14" /> Archived</span>
      <button class="icon" title="Close archive (Esc)" @click="app.closeArchive()"><X :size="15" /></button>
    </header>

    <div class="filter">
      <input
        ref="inputEl"
        v-model="query"
        class="input"
        type="search"
        placeholder="Filter archived conversations…"
        spellcheck="false"
        autocomplete="off"
      />
      <button v-if="query" class="icon" title="Clear filter" @click="query = ''"><X :size="13" /></button>
    </div>

    <div class="body">
      <p v-if="loading" class="note"><Spinner :size="11" /> Loading archived conversations…</p>
      <p v-else-if="error" class="fail">{{ error }}</p>
      <template v-else>
        <p v-if="actionError" class="fail">{{ actionError }}</p>

        <div
          v-for="session in filtered"
          :key="session.id"
          class="row"
          :class="{ active: isActive(session.id), confirming: confirming === session.id }"
          role="button"
          tabindex="0"
          @click="view(session)"
          @keydown.enter.prevent="view(session)"
        >
          <template v-if="confirming === session.id">
            <span class="confirm-text">Delete permanently?</span>
            <button class="confirm-cancel" @click.stop="confirming = null">Cancel</button>
            <button class="confirm-delete" :disabled="deleting.has(session.id)" @click.stop="remove(session)">
              <Spinner v-if="deleting.has(session.id)" :size="11" />
              <template v-else>Delete</template>
            </button>
          </template>
          <template v-else>
            <span class="session-title" :title="session.title || 'Untitled'">{{ session.title || "Untitled" }}</span>
            <span class="time">{{ archivedLabel(session) }}</span>
            <button
              class="icon"
              :title="restoring.has(session.id) ? 'Restoring…' : 'Restore conversation'"
              :disabled="restoring.has(session.id)"
              @click.stop="restore(session)"
            >
              <Spinner v-if="restoring.has(session.id)" :size="11" />
              <ArchiveRestore v-else :size="13" />
            </button>
            <button class="icon danger" title="Delete conversation" @click.stop="askDelete(session.id)">
              <Trash2 :size="13" />
            </button>
          </template>
        </div>

        <p v-if="!filtered.length" class="note">
          {{ query.trim() ? `Nothing matches “${query.trim()}”.` : "No archived conversations." }}
        </p>
      </template>
    </div>

    <footer v-if="!loading && !error" class="foot">
      <span>{{ filtered.length }} archived conversation{{ filtered.length === 1 ? "" : "s" }}</span>
      <span v-if="query.trim() && filtered.length !== archived.length" class="of">of {{ archived.length }}</span>
    </footer>
  </div>
</template>

<style scoped>
.archive {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--header-height, 44px);
  padding: 0 10px;
}
.title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
}
.icon:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.icon:disabled {
  opacity: 0.6;
}
.icon.danger:hover:not(:disabled) {
  color: var(--danger);
}
.filter {
  flex: none;
  display: flex;
  align-items: center;
  margin: 0 10px 8px;
  padding: 0 6px 0 8px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input, var(--bg-elevated));
}
.filter:focus-within {
  border-color: var(--accent);
}
.input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}
.input::-webkit-search-cancel-button {
  display: none;
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.row:hover {
  background: var(--bg-hover);
}
.row:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.row.active {
  background: var(--bg-active);
}
.row.active .session-title {
  color: var(--text);
}
.session-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text-muted);
}
.time {
  flex: none;
  font-size: 10.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
.confirm-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--danger);
}
.confirm-cancel,
.confirm-delete {
  flex: none;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  padding: 3px 8px;
}
.confirm-cancel {
  background: transparent;
  color: var(--text-muted);
}
.confirm-cancel:hover {
  background: var(--bg-active);
  color: var(--text);
}
.confirm-delete {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--danger);
  color: var(--accent-text, #fff);
}
.confirm-delete:disabled {
  opacity: 0.7;
}
.note,
.fail {
  padding: 10px 8px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.fail {
  color: var(--danger);
}
.foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-faint);
}
.of {
  color: var(--text-muted);
}
</style>
