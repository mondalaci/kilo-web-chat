<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { X, CircleAlert, Check, Share2 } from "lucide-vue-next"
import type { AssistantMessage } from "@/api/types"
import Sidebar from "./Sidebar.vue"
import MessageThread from "./MessageThread.vue"
import Composer from "./Composer.vue"
import PromptDock from "./PromptDock.vue"
import { useApp } from "@/stores/app"
import { requestComposerFocus } from "@/stores/draft"
import { requestOpen, shortcutKeys, shortcutsVisible } from "@/stores/shortcuts"
import { formatCost } from "@/utils/format"

const app = useApp()
const { current, currentID } = app.sessions
const { error, messages } = app.chat
const { providers, selectedModelInfo } = app.server
const { newChat } = app

const shareState = ref<"idle" | "shared" | "copied">("idle")

function flashShare(state: "shared" | "copied") {
  shareState.value = state
  setTimeout(() => {
    shareState.value = "idle"
  }, 1500)
}

/**
 * Share via Kilo's server-side share feature (a public link). Falls back to
 * copying the local per-chat URL if the server cannot create a share.
 */
async function shareChat() {
  const sessionID = currentID.value
  if (sessionID) {
    const shared = await app.shareSession(sessionID)
    if (shared) {
      if (navigator.share) {
        try {
          await navigator.share({ title: title.value, url: shared })
          flashShare("shared")
          return
        } catch {
          /* user cancelled */
        }
      }
      window.open(shared, "_blank", "noopener")
      flashShare("shared")
      return
    }
  }
  const url = new URL(window.location.href)
  if (sessionID) url.searchParams.set("session", sessionID)
  else url.searchParams.delete("session")
  try {
    await navigator.clipboard.writeText(url.toString())
    flashShare("copied")
  } catch {
    /* clipboard unavailable */
  }
}

const SIDEBAR_KEY = "kilo-web-chat.sidebar-width"
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 520
const DEFAULT_SIDEBAR = 264

function loadSidebarWidth() {
  const value = Number(localStorage.getItem(SIDEBAR_KEY))
  return Number.isFinite(value) && value >= SIDEBAR_MIN && value <= SIDEBAR_MAX ? value : DEFAULT_SIDEBAR
}

const sidebarWidth = ref(loadSidebarWidth())

function applySidebarWidth() {
  document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth.value}px`)
}

/** Split.js-style drag handle between the sidebar and the conversation. */
function startResize(event: PointerEvent) {
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const onMove = (move: PointerEvent) => {
    sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, move.clientX))
    applySidebarWidth()
  }
  const onUp = () => {
    handle.removeEventListener("pointermove", onMove)
    handle.removeEventListener("pointerup", onUp)
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth.value))
    } catch {
      /* ignore */
    }
  }
  handle.addEventListener("pointermove", onMove)
  handle.addEventListener("pointerup", onUp)
}

const title = computed(() => current.value?.title || "New chat")

// Session cost: the higher of the session total and the sum of assistant message
// costs, matching the TUI.
const sessionCost = computed(() => {
  const total = messages.value.reduce((sum, item) => (item.info.role === "assistant" ? sum + (item.info.cost ?? 0) : sum), 0)
  return Math.max(current.value?.cost ?? 0, total)
})

// Context usage is taken from the last assistant message that produced output.
const lastAssistant = computed<AssistantMessage | null>(() => {
  const list = messages.value
  for (let i = list.length - 1; i >= 0; i--) {
    const info = list[i].info
    if (info.role === "assistant" && (info.tokens?.output ?? 0) > 0) return info
  }
  return null
})

const contextTokens = computed(() => {
  const tokens = lastAssistant.value?.tokens
  if (!tokens) return 0
  return (
    (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
  )
})

const contextLimit = computed(() => {
  const info = lastAssistant.value
  if (info) {
    const model = providers.value.find((provider) => provider.id === info.providerID)?.models?.[info.modelID]
    if (model?.limit?.context) return model.limit.context
  }
  return selectedModelInfo.value?.limit?.context ?? 0
})

const contextPercent = computed(() => (contextLimit.value ? Math.round((contextTokens.value / contextLimit.value) * 100) : 0))

const costTitle = computed(() => `Session cost: ${formatCost(sessionCost.value)}`)
const contextTitle = computed(() =>
  contextLimit.value
    ? `${contextTokens.value.toLocaleString()} tokens (${contextPercent.value}% of context)`
    : `${contextTokens.value.toLocaleString()} tokens`,
)

function dismissError() {
  error.value = null
}

/**
 * Shortcuts use `Alt` + a letter; matching on `event.code` keeps them working on
 * macOS, where Option+letter produces a different `event.key`. Holding Alt
 * reveals the key badges on the controls they trigger.
 */
function onKeyDown(event: KeyboardEvent) {
  if (event.altKey) shortcutsVisible.value = true
  if (!event.altKey) return
  switch (event.code) {
    case shortcutKeys.model:
      event.preventDefault()
      requestOpen("model")
      break
    case shortcutKeys.agent:
      event.preventDefault()
      requestOpen("agent")
      break
    case shortcutKeys.project:
      event.preventDefault()
      requestOpen("project")
      break
    case shortcutKeys.sessions:
      event.preventDefault()
      requestOpen("sessions")
      break
    case shortcutKeys.effort:
      event.preventDefault()
      requestOpen("effort")
      break
    case shortcutKeys.tools:
      event.preventDefault()
      requestOpen("tools")
      break
    case shortcutKeys.newChat:
      event.preventDefault()
      void newChat()
      break
    case shortcutKeys.focusChat:
      event.preventDefault()
      requestComposerFocus()
      break
    default:
      break
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === "Alt" || !event.altKey) shortcutsVisible.value = false
}

function onBlur() {
  shortcutsVisible.value = false
}

function onPopState() {
  void app.openSessionFromUrl()
}

onMounted(() => {
  applySidebarWidth()
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("keyup", onKeyUp)
  window.addEventListener("blur", onBlur)
  window.addEventListener("popstate", onPopState)
})
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown)
  window.removeEventListener("keyup", onKeyUp)
  window.removeEventListener("blur", onBlur)
  window.removeEventListener("popstate", onPopState)
  shortcutsVisible.value = false
})
</script>

<template>
  <div class="shell">
    <div class="sidebar-host">
      <Sidebar />
    </div>
    <div class="resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" @pointerdown="startResize"></div>

    <main class="main">
      <header class="topbar">
        <h1 class="title">{{ title }}</h1>
        <div v-if="current" class="stats">
          <span class="stat" :title="costTitle">{{ formatCost(sessionCost) }}</span>
          <span class="stat-divider">·</span>
          <span class="stat" :class="{ warn: contextPercent >= 80 }" :title="contextTitle">
            {{ contextLimit ? `${contextPercent}%` : "—" }}
          </span>
        </div>
        <button
          class="share-btn"
          :class="{ active: shareState !== 'idle' }"
          :title="shareState === 'shared' ? 'Shared' : shareState === 'copied' ? 'Link copied' : 'Share chat'"
          aria-label="Share chat"
          @click="shareChat"
        >
          <Check v-if="shareState !== 'idle'" :size="16" />
          <Share2 v-else :size="16" />
        </button>
      </header>

      <MessageThread />

      <div class="bottom">
        <div v-if="error" class="error-banner">
          <CircleAlert :size="15" />
          <span>{{ error }}</span>
          <button @click="dismissError"><X :size="14" /></button>
        </div>
        <PromptDock />
        <Composer />
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.sidebar-host {
  flex: none;
  height: 100%;
}
@media (max-width: 720px) {
  .sidebar-host {
    display: none;
  }
}
.resizer {
  flex: none;
  width: 5px;
  cursor: col-resize;
  touch-action: none;
  background: transparent;
  transition: background 0.12s;
}
.resizer:hover,
.resizer:active {
  background: var(--accent);
  opacity: 0.5;
}
@media (max-width: 720px) {
  .resizer {
    display: none;
  }
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.topbar {
  position: relative;
  z-index: 2;
  height: var(--header-height);
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: blur(8px);
}
/* Fade the top of the conversation toward the header. */
.topbar::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: 14px;
  background: linear-gradient(to bottom, var(--bg), transparent);
  pointer-events: none;
  z-index: 1;
}
.title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.stats {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.stat {
  cursor: default;
}
.stat:hover {
  color: var(--text-muted);
}
.stat.warn {
  color: var(--accent);
}
.stat-divider {
  opacity: 0.5;
}
.share-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 12px;
  padding: 5px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
}
.share-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.share-btn.copied,
.share-btn.active {
  color: #4ade80;
}
.bottom {
  position: relative;
  flex: none;
}
/* Fade the conversation out as it approaches the composer. */
.bottom::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -10px;
  height: 10px;
  background: linear-gradient(to bottom, transparent, var(--bg));
  pointer-events: none;
  z-index: 1;
}
.error-banner {
  max-width: var(--content-width);
  margin: 0 auto 10px;
  width: calc(100% - 40px);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.error-banner span {
  flex: 1;
}
.error-banner button {
  background: transparent;
  border: none;
  color: inherit;
  display: inline-flex;
}
</style>