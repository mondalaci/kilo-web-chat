<script setup lang="ts">
import { ref, watch } from "vue"
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui"
import { Check, ChevronDown, Sparkles } from "lucide-vue-next"
import { useServer } from "@/stores/server"
import { openRequests, shortcutsVisible } from "@/stores/shortcuts"

const { modes, selectedAgent } = useServer()

const open = ref(false)

// Opened by the Alt+A shortcut.
watch(
  () => openRequests.agent,
  () => {
    open.value = true
  },
)

function label(name: string) {
  const agent = modes.value.find((item) => item.name === name)
  return agent?.displayName ?? name
}
</script>

<template>
  <SelectRoot v-model="selectedAgent" v-model:open="open">
    <SelectTrigger class="trigger" aria-label="Mode (Alt+A)">
      <Sparkles :size="14" class="trigger-icon" />
      <SelectValue :placeholder="label(selectedAgent)" />
      <kbd v-if="shortcutsVisible" class="kbd">A</kbd>
      <SelectIcon class="trigger-chevron"><ChevronDown :size="14" /></SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="kilo-menu" position="popper" :side-offset="6">
        <SelectViewport>
          <SelectItem v-for="mode in modes" :key="mode.name" :value="mode.name" class="kilo-menu-item">
            <div class="mode-item">
              <SelectItemText class="mode-name">{{ mode.displayName ?? mode.name }}</SelectItemText>
              <span v-if="mode.description" class="mode-desc">{{ mode.description }}</span>
            </div>
            <SelectItemIndicator class="check"><Check :size="14" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped>
.trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.trigger:hover {
  background: var(--bg-hover);
}
.trigger:focus-visible {
  border-color: var(--accent);
}
.trigger-icon {
  color: var(--accent);
}
.trigger-chevron {
  color: var(--text-muted);
}
.mode-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: 360px;
}
.mode-name {
  text-transform: capitalize;
  font-weight: 500;
}
.mode-desc {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: normal;
  line-height: 1.35;
}
.check {
  margin-left: auto;
  color: var(--accent);
}
</style>