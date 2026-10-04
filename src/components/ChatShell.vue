<script setup lang="ts">
import { computed, ref } from "vue"
import { Menu, PanelLeft, X, CircleAlert } from "lucide-vue-next"
import Sidebar from "./Sidebar.vue"
import MessageThread from "./MessageThread.vue"
import Composer from "./Composer.vue"
import PromptDock from "./PromptDock.vue"
import { useApp } from "@/stores/app"

const app = useApp()
const { current } = app.sessions
const { error, isBusy } = app.chat
const { live } = app.live

const sidebarOpen = ref(false)

const title = computed(() => current.value?.title || "New chat")

function dismissError() {
  error.value = null
}
</script>

<template>
  <div class="shell">
    <div class="sidebar-host" :class="{ open: sidebarOpen }">
      <Sidebar @click="sidebarOpen = false" />
    </div>
    <div v-if="sidebarOpen" class="scrim" @click="sidebarOpen = false"></div>

    <main class="main">
      <header class="topbar">
        <button class="toggle" title="Toggle sidebar" @click="sidebarOpen = !sidebarOpen">
          <Menu :size="18" class="menu-icon" />
          <PanelLeft :size="18" class="panel-icon" />
        </button>
        <h1 class="title">{{ title }}</h1>
        <span class="status" :class="{ busy: isBusy, live }">
          <span class="status-dot"></span>
          {{ isBusy ? "working" : live ? "live" : "reconnecting" }}
        </span>
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
.scrim {
  display: none;
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
.toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 6px;
  border-radius: var(--radius-sm);
}
.toggle:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.panel-icon {
  display: none;
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
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-faint);
  flex: none;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
}
.status.live .status-dot {
  background: #4ade80;
}
.status.busy .status-dot {
  background: var(--accent);
  animation: kilo-pulse 1.2s ease-in-out infinite;
}
@keyframes kilo-pulse {
  50% {
    opacity: 0.35;
  }
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
@media (max-width: 820px) {
  .sidebar-host {
    position: fixed;
    z-index: 45;
    top: 0;
    left: 0;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: var(--shadow);
  }
  .sidebar-host.open {
    transform: translateX(0);
  }
  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 44;
  }
  .menu-icon {
    display: none;
  }
  .panel-icon {
    display: block;
  }
}
@media (min-width: 821px) {
  .menu-icon {
    display: none;
  }
  .panel-icon {
    display: block;
    opacity: 0.7;
  }
}
</style>