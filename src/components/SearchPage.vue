<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Search, X } from "lucide-vue-next"
import type { SessionInfo } from "@/api/types"
import { useApp } from "@/stores/app"
import { closeSearch } from "@/stores/search"
import { relativeTime } from "@/utils/format"

const app = useApp()
const client = app.connection.client
const directory = app.server.directory

const query = ref("")
const results = ref<SessionInfo[]>([])
const loading = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const resultsEl = ref<HTMLElement | null>(null)
/** Index of the keyboard-highlighted result, or -1. */
const navIndex = ref(-1)

let debounce: ReturnType<typeof setTimeout> | null = null
/** Guards against out-of-order responses from rapid typing. */
let requestSeq = 0

async function run(raw: string) {
  const active = client.value
  if (!active) return
  const search = raw.trim()
  const seq = ++requestSeq
  loading.value = true
  try {
    const list = await app.sessions.query(active, {
      directory: directory.value,
      search: search || undefined,
      // Empty query shows recent conversations; a query searches the whole set.
      limit: search ? 100000 : 100,
    })
    if (seq !== requestSeq) return
    results.value = list
    navIndex.value = list.length ? 0 : -1
    void nextTick(() => resultsEl.value?.scrollTo({ top: 0 }))
  } catch {
    if (seq === requestSeq) results.value = []
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

watch(query, (value) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void run(value), 200)
})

onMounted(() => {
  inputEl.value?.focus()
  void run("")
})

onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce)
  requestSeq++
})

const heading = computed(() => (query.value.trim() ? "Results" : "Recent conversations"))

function open(session: SessionInfo) {
  closeSearch()
  void app.openSessionByID(session.id)
}

function scrollNavIntoView() {
  const items = resultsEl.value?.querySelectorAll<HTMLElement>(".result")
  items?.[navIndex.value]?.scrollIntoView({ block: "nearest" })
}

function move(delta: number) {
  navIndex.value = Math.min(results.value.length - 1, Math.max(0, navIndex.value + delta))
  void nextTick(scrollNavIntoView)
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case "Escape":
      event.preventDefault()
      closeSearch()
      break
    case "ArrowDown":
      event.preventDefault()
      move(1)
      break
    case "ArrowUp":
      event.preventDefault()
      move(-1)
      break
    case "Enter": {
      event.preventDefault()
      const session = results.value[navIndex.value]
      if (session) open(session)
      break
    }
    default:
      break
  }
}
</script>

<template>
  <section class="search-page" role="dialog" aria-label="Search conversations" @keydown="onKeydown">
    <header class="search-head">
      <div class="search-field">
        <Search :size="16" class="search-icon" />
        <input
          ref="inputEl"
          v-model="query"
          class="search-input"
          type="search"
          placeholder="Search conversations…"
          spellcheck="false"
          autocomplete="off"
        />
        <button v-if="query" class="clear" title="Clear" @click="query = ''"><X :size="15" /></button>
      </div>
      <button class="close" title="Close search (Esc)" @click="closeSearch()"><X :size="18" /></button>
    </header>

    <div class="search-body">
      <div class="results-head">
        <span>{{ heading }}</span>
        <span v-if="loading" class="loading">searching…</span>
        <span v-else-if="results.length" class="count">{{ results.length }}</span>
      </div>

      <div ref="resultsEl" class="results">
        <button
          v-for="(session, index) in results"
          :key="session.id"
          class="result"
          :class="{ active: index === navIndex, current: session.id === app.sessions.currentID.value }"
          @click="open(session)"
          @mousemove="navIndex = index"
        >
          <span class="result-title">{{ session.title || "Untitled" }}</span>
          <span class="result-time">{{ relativeTime(session.time?.updated ?? session.time?.created) }}</span>
        </button>

        <p v-if="!loading && !results.length" class="empty">
          {{ query.trim() ? `No conversations match “${query.trim()}”.` : "No conversations yet." }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search-page {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.search-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--header-height);
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
}
.search-field {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 0 10px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
}
.search-field:focus-within {
  border-color: var(--accent);
}
.search-icon {
  flex: none;
  color: var(--text-muted);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
}
.search-input::-webkit-search-cancel-button {
  display: none;
}
.clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  padding: 3px;
  border-radius: 5px;
}
.clear:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  padding: 6px;
  border-radius: var(--radius-sm);
}
.close:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.search-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 12px 18px 0;
}
.results-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 8px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}
.results-head .loading,
.results-head .count {
  text-transform: none;
  letter-spacing: 0;
}
.results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 18px;
}
.result {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  text-align: left;
}
.result:hover,
.result.active {
  background: var(--bg-hover);
}
.result.current {
  box-shadow: inset 0 0 0 2px var(--accent);
}
.result-title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-time {
  flex: none;
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 40px 0;
}
</style>
