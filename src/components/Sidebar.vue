<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui"
import {
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  Moon,
  Pencil,
  Server,
  Sun,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-vue-next"
import Spinner from "./Spinner.vue"
import { useApp } from "@/stores/app"
import { relativeTime } from "@/utils/format"
import { theme, toggleTheme } from "@/theme"
import { shortcutsVisible } from "@/stores/shortcuts"

const app = useApp()
const { sorted, currentID, loading } = app.sessions
const { connected, connectError } = app.connection
const { live, connecting } = app.live
const { isBusy } = app.chat
const { newChat, selectSession, removeSession, renameSession, disconnect } = app

const editingID = ref<string | null>(null)
const editTitle = ref("")
const editInput = ref<HTMLInputElement | null>(null)

type ConnectionState = "offline" | "connecting" | "working" | "live" | "reconnecting"
const connectionState = computed<ConnectionState>(() => {
  if (!connected.value) return "offline"
  if (connecting.value) return "connecting"
  if (isBusy.value) return "working"
  if (live.value) return "live"
  return "reconnecting"
})
const connectionLabel = computed(
  () =>
    ({
      offline: "offline",
      connecting: "connecting…",
      working: "working",
      live: "live",
      reconnecting: "reconnecting…",
    })[connectionState.value],
)

function setRenameInput(el: Element | { $el?: Element } | null) {
  if (!el) {
    editInput.value = null
    return
  }
  const node = (el as { $el?: Element }).$el ?? (el as Element)
  editInput.value = node instanceof HTMLInputElement ? node : null
}

async function startRename(id: string, title: string) {
  editingID.value = id
  editTitle.value = title
  await nextTick()
  editInput.value?.focus()
  editInput.value?.select()
}

async function commitRename() {
  const id = editingID.value
  if (!id) return
  const title = editTitle.value.trim()
  editingID.value = null
  if (title) await renameSession(id, title)
}

function cancelRename() {
  editingID.value = null
}
</script>

<template>
  <aside class="sidebar">
    <header class="head">
      <div class="brand">
        <span class="logo">K</span>
        <span class="brand-name">Kilo Chat</span>
      </div>
      <button class="icon" title="New chat" @click="newChat()"><MessageSquarePlus :size="18" /></button>
    </header>

    <button class="new-chat" title="New chat (Alt+N)" @click="newChat()">
      <MessageSquarePlus :size="16" />
      New chat
      <kbd v-if="shortcutsVisible" class="kbd">N</kbd>
    </button>

    <nav class="sessions">
      <div v-if="loading && !sorted.length" class="muted"><Spinner :size="14" /></div>
      <button
        v-for="session in sorted"
        :key="session.id"
        class="session"
        :class="{ active: session.id === currentID }"
        @click="selectSession(session.id)"
        @dblclick="startRename(session.id, session.title)"
      >
        <input
          v-if="editingID === session.id"
          :ref="setRenameInput"
          v-model="editTitle"
          class="rename"
          @click.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <template v-else>
          <span class="session-title">{{ session.title || "Untitled" }}</span>
          <span class="session-time">{{ relativeTime(session.time?.updated ?? session.time?.created) }}</span>
        </template>
        <DropdownMenuRoot v-if="editingID !== session.id">
          <DropdownMenuTrigger as-child>
            <span class="session-menu" @click.stop><MoreHorizontal :size="15" /></span>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="kilo-menu" :side-offset="4" align="start">
              <DropdownMenuItem class="kilo-menu-item" @select="startRename(session.id, session.title)">
                <Pencil :size="14" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator class="kilo-menu-sep" />
              <DropdownMenuItem class="kilo-menu-item danger" @select="removeSession(session.id)">
                <Trash2 :size="14" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </button>
      <p v-if="!loading && !sorted.length" class="muted empty">No conversations yet</p>
    </nav>

    <footer class="foot">
      <div class="conn" :class="connectionState" :title="connectError ?? connected?.origin">
        <component
          :is="connected ? (connectionState === 'live' || connectionState === 'working' ? Wifi : WifiOff) : Server"
          :size="14"
          class="conn-icon"
        />
        <div class="conn-text">
          <span class="conn-origin">{{ connected?.origin ?? "Not connected" }}</span>
          <span class="conn-status">{{ connectionLabel }}</span>
        </div>
        <span class="conn-dot"></span>
      </div>
      <div class="foot-actions">
        <button class="icon" :title="theme === 'dark' ? 'Light theme' : 'Dark theme'" @click="toggleTheme()">
          <Sun v-if="theme === 'dark'" :size="16" />
          <Moon v-else :size="16" />
        </button>
        <button class="icon" title="Disconnect" @click="disconnect()"><LogOut :size="16" /></button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  flex: none;
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
}
.logo {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--accent-text);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
}
.brand-name {
  font-weight: 600;
  font-size: 14px;
}
.new-chat {
  margin: 4px 10px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 13.5px;
}
.new-chat:hover {
  background: var(--bg-hover);
}
.new-chat .kbd {
  margin-left: auto;
}
.sessions {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.session {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  text-align: left;
  width: 100%;
}
.session:hover {
  background: var(--bg-hover);
}
.session.active {
  background: var(--bg-active);
}
.session-title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-time {
  flex: none;
  font-size: 11px;
  color: var(--text-faint);
}
.session:hover .session-time {
  visibility: hidden;
}
.session-menu {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  color: var(--text-muted);
  opacity: 0;
  padding: 3px;
  border-radius: 5px;
}
.session:hover .session-menu {
  opacity: 1;
}
.session-menu:hover {
  background: var(--bg-active);
}
.rename {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--accent);
  border-radius: 5px;
  padding: 3px 6px;
  font-size: 13px;
  outline: none;
}
.muted {
  color: var(--text-faint);
  font-size: 12.5px;
}
.empty {
  text-align: center;
  padding: 22px 0;
}
.foot {
  border-top: 1px solid var(--border);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.conn {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-muted);
}
.conn-icon {
  flex: none;
}
.conn.live .conn-icon,
.conn.working .conn-icon {
  color: #4ade80;
}
.conn.connecting .conn-icon,
.conn.reconnecting .conn-icon {
  color: var(--accent);
}
.conn-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.conn-origin {
  font-family: var(--font-mono);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conn-status {
  font-size: 10.5px;
  color: var(--text-faint);
}
.conn-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
}
.conn.live .conn-dot {
  background: #4ade80;
}
.conn.working .conn-dot {
  background: var(--accent);
  animation: kilo-pulse 1.2s ease-in-out infinite;
}
.conn.connecting .conn-dot,
.conn.reconnecting .conn-dot {
  background: var(--accent);
}
@keyframes kilo-pulse {
  50% {
    opacity: 0.35;
  }
}
.foot-actions {
  display: flex;
  gap: 6px;
}
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 6px;
  border-radius: var(--radius-sm);
}
.icon:hover {
  background: var(--bg-hover);
  color: var(--text);
}
</style>