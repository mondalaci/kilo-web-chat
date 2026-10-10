<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Search, X } from "lucide-vue-next"
import { searchContent, searchHealth, listAllSessions } from "@/api/search"
import { useApp } from "@/stores/app"
import { closeSearch } from "@/stores/search"
import { relativeTime } from "@/utils/format"

const app = useApp()
const client = app.connection.client
const directory = app.server.directory

/** Unified result row, whether it came from content search or title search. */
interface Hit {
  id: string
  title: string
  updated?: number
  snippet?: string
}

const query = ref("")
const hits = ref<Hit[]>([])
const loading = ref(false)
/** Which backend answered the last (or an initial probe) search. */
const mode = ref<"unknown" | "content" | "fallback">("unknown")
/** Total conversations known to the search service. */
const total = ref<number | null>(null)
/** When true, the list shows every conversation instead of search results. */
const all = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const resultsEl = ref<HTMLElement | null>(null)
/** Index of the keyboard-highlighted result, or -1. */
const navIndex = ref(-1)

let debounce: ReturnType<typeof setTimeout> | null = null
/** Guards against out-of-order responses from rapid typing. */
let requestSeq = 0

function titleHits(list: Awaited<ReturnType<typeof app.sessions.query>>): Hit[] {
  return list.map((session) => ({
    id: session.id,
    title: session.title || "Untitled",
    updated: session.time?.updated ?? session.time?.created,
  }))
}

async function run(raw: string) {
  const active = client.value
  const search = raw.trim()
  const seq = ++requestSeq
  all.value = false
  loading.value = true
  try {
    if (!search) {
      hits.value = active ? titleHits(await app.sessions.query(active, { directory: directory.value, limit: 100 })) : []
    } else {
      let done = false
      try {
        const results = await searchContent(search, 30)
        if (seq !== requestSeq) return
        hits.value = results.map((hit) => ({
          id: hit.sessionID,
          title: hit.title || "Untitled",
          updated: hit.updated,
          snippet: hit.snippet,
        }))
        mode.value = "content"
        done = true
      } catch {
        // Service offline: fall back to server title search below.
        mode.value = "fallback"
      }
      if (!done) {
        const list = active
          ? await app.sessions.query(active, { directory: directory.value, search, limit: 100000 })
          : []
        if (seq !== requestSeq) return
        hits.value = titleHits(list)
      }
    }
    navIndex.value = hits.value.length ? 0 : -1
    void nextTick(() => resultsEl.value?.scrollTo({ top: 0 }))
  } catch {
    if (seq === requestSeq) hits.value = []
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

/** Load and display every conversation, newest first. */
async function showAll() {
  const active = client.value
  const seq = ++requestSeq
  all.value = true
  query.value = ""
  loading.value = true
  try {
    let list: Hit[] = []
    try {
      const page = await listAllSessions()
      list = page.results.map((hit) => ({
        id: hit.sessionID,
        title: hit.title || "Untitled",
        updated: hit.updated,
      }))
      total.value = page.total
      mode.value = "content"
    } catch {
      mode.value = "fallback"
      if (active) list = titleHits(await app.sessions.query(active, { directory: directory.value, limit: 100000 }))
    }
    if (seq !== requestSeq) return
    hits.value = list
    navIndex.value = list.length ? 0 : -1
    void nextTick(() => resultsEl.value?.scrollTo({ top: 0 }))
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
  void searchHealth().then((health) => {
    if (health) {
      mode.value = "content"
      total.value = health.sessions
    } else {
      mode.value = "fallback"
    }
  })
  void run("")
})

onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce)
  requestSeq++
})

const heading = computed(() =>
  all.value ? "All conversations" : query.value.trim() ? "Results" : "Recent conversations",
)

const modeLabel = computed(() =>
  mode.value === "content" ? "Content search" : mode.value === "fallback" ? "Fallback · titles" : "Checking…",
)
const modeTitle = computed(() =>
  mode.value === "content"
    ? "Using the local kilo-search service (FTS5/BM25 over message text)"
    : mode.value === "fallback"
      ? "kilo-search is unreachable — matching conversation titles only"
      : "Checking the local kilo-search service…",
)

function open(hit: Hit) {
  closeSearch()
  void app.openSessionByID(hit.id)
}

function scrollNavIntoView() {
  const items = resultsEl.value?.querySelectorAll<HTMLElement>(".result")
  items?.[navIndex.value]?.scrollIntoView({ block: "nearest" })
}

function move(delta: number) {
  navIndex.value = Math.min(hits.value.length - 1, Math.max(0, navIndex.value + delta))
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
      const hit = hits.value[navIndex.value]
      if (hit) open(hit)
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
      <div class="search-mode" :class="mode" :title="modeTitle">
        <span class="mode-dot"></span>
        {{ modeLabel }}
      </div>
      <button class="close" title="Close search (Esc)" @click="closeSearch()"><X :size="18" /></button>
    </header>

    <div class="search-body">
      <div class="results-head">
        <span>{{ heading }}</span>
        <span v-if="loading" class="loading">searching…</span>
        <span v-else-if="hits.length" class="count">{{ hits.length }}</span>
      </div>

      <div ref="resultsEl" class="results">
        <button
          v-for="(hit, index) in hits"
          :key="hit.id"
          class="result"
          :class="{ active: index === navIndex, current: hit.id === app.sessions.currentID.value }"
          @click="open(hit)"
          @mousemove="navIndex = index"
        >
          <span class="result-line">
            <span class="result-title">{{ hit.title }}</span>
            <span class="result-time">{{ relativeTime(hit.updated) }}</span>
          </span>
          <span v-if="hit.snippet" class="result-snippet">{{ hit.snippet }}</span>
        </button>

        <p v-if="!loading && !hits.length" class="empty">
          {{ query.trim() ? `No conversations match “${query.trim()}”.` : "No conversations yet." }}
        </p>
      </div>

      <footer class="search-foot">
        <span class="total">{{ total == null ? "—" : `${total.toLocaleString()} conversations` }}</span>
        <button class="browse" :disabled="loading || all" @click="showAll">List all conversations</button>
      </footer>
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
.search-mode {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  cursor: default;
}
.mode-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
}
.search-mode.content .mode-dot {
  background: #35c06a;
}
.search-mode.fallback .mode-dot {
  background: var(--accent);
}
@media (max-width: 620px) {
  .search-mode {
    display: none;
  }
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
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
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
.result-line {
  display: flex;
  align-items: center;
  gap: 12px;
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
.result-snippet {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 40px 0;
}
.search-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 4px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-faint);
}
.browse {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
}
.browse:hover:not(:disabled) {
  background: var(--bg-hover);
}
.browse:disabled {
  color: var(--text-faint);
  cursor: default;
}
</style>
