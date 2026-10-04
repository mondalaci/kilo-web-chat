<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue"
import { X, CircleAlert } from "lucide-vue-next"
import type { AssistantMessage } from "@/api/types"
import Sidebar from "./Sidebar.vue"
import MessageThread from "./MessageThread.vue"
import Composer from "./Composer.vue"
import PromptDock from "./PromptDock.vue"
import { useApp } from "@/stores/app"
import { requestOpen, shortcutKeys, shortcutsVisible } from "@/stores/shortcuts"
import { formatCost } from "@/utils/format"

const app = useApp()
const { current } = app.sessions
const { error, messages } = app.chat
const { providers, selectedModelInfo } = app.server
const { newChat } = app

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
    case shortcutKeys.newChat:
      event.preventDefault()
      void newChat()
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

onMounted(() => {
  window.addEventListener("keydown", onKeyDown)
  window.addEventListener("keyup", onKeyUp)
  window.addEventListener("blur", onBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown)
  window.removeEventListener("keyup", onKeyUp)
  window.removeEventListener("blur", onBlur)
  shortcutsVisible.value = false
})
</script>

<template>
  <div class="shell">
    <div class="sidebar-host">
      <Sidebar />
    </div>

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
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.topbar {
  height: var(--header-height);
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: blur(8px);
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
.bottom {
  flex: none;
  border-top: 1px solid var(--border);
  padding-top: 10px;
  background: var(--bg);
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