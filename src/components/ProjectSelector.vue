<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui"
import { Check, ChevronDown, Folder } from "lucide-vue-next"
import type { Project } from "@/api/types"
import { useApp } from "@/stores/app"
import { useServer } from "@/stores/server"
import { openRequests, shortcutsVisible } from "@/stores/shortcuts"

const { switchProject } = useApp()
const { projects, directory } = useServer()

const open = ref(false)
const query = ref("")
const inputRef = ref<unknown>(null)

function projectName(path: string | undefined) {
  if (!path) return ""
  if (path === "/") return "root"
  return path.split("/").filter(Boolean).pop() ?? path
}

const sortedProjects = computed(() =>
  [...projects.value].sort((a, b) =>
    (a.name || projectName(a.worktree)).localeCompare(b.name || projectName(b.worktree)),
  ),
)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return sortedProjects.value
  return sortedProjects.value.filter(
    (project) =>
      (project.name || projectName(project.worktree)).toLowerCase().includes(q) ||
      project.worktree.toLowerCase().includes(q),
  )
})

const selectedKey = computed<string>({
  get: () => directory.value ?? "",
  set: (value) => {
    if (!value || value === directory.value) return
    void switchProject(value)
    open.value = false
  },
})

function displayValue(value: string) {
  const project = projects.value.find((item) => item.worktree === value)
  return project?.name || projectName(value)
}

function isActive(project: Project) {
  return project.worktree === directory.value
}

function inputNode(): HTMLInputElement | null {
  const value = inputRef.value as { $el?: unknown } | HTMLInputElement | null
  return ((value && "$el" in value ? value.$el : value) ?? null) as HTMLInputElement | null
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
}

function selectDisplayValue() {
  if (query.value) return
  requestAnimationFrame(() => inputNode()?.select())
}

watch(open, async (value) => {
  if (value) {
    await nextTick()
    const node = inputNode()
    node?.focus()
    if (!query.value) node?.select()
  } else {
    query.value = ""
  }
})

// Opened by the Alt+P shortcut.
watch(
  () => openRequests.project,
  () => {
    open.value = true
  },
)
</script>

<template>
  <ComboboxRoot
    v-model="selectedKey"
    v-model:open="open"
    :ignore-filter="true"
    :open-on-click="true"
    :open-on-focus="true"
    class="kilo-project-root"
  >
    <ComboboxAnchor class="kilo-project-anchor" title="Switch project (Alt+P)">
      <Folder :size="13" class="kilo-project-icon" />
      <ComboboxInput
        ref="inputRef"
        class="kilo-project-input"
        :display-value="displayValue"
        placeholder="Select project…"
        spellcheck="false"
        @input="onInput"
        @focus="selectDisplayValue"
        @click="selectDisplayValue"
      />
      <kbd v-if="shortcutsVisible" class="kbd floating">P</kbd>
      <ComboboxTrigger class="kilo-project-chevron" aria-label="Switch project (Alt+P)">
        <ChevronDown :size="14" />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent class="kilo-menu kilo-project-menu" position="popper" side="top" :side-offset="8" align="end">
        <ComboboxViewport class="kilo-project-scroll">
          <ComboboxEmpty class="kilo-project-empty">
            {{ query ? `No projects match “${query}”.` : "No projects." }}
          </ComboboxEmpty>
          <ComboboxItem
            v-for="project in filtered"
            :key="project.worktree"
            :value="project.worktree"
            :text-value="project.name || projectName(project.worktree)"
            class="kilo-project-option"
            :class="{ 'is-active': isActive(project) }"
          >
            <span class="kilo-project-name">{{ project.name || projectName(project.worktree) }}</span>
            <span class="kilo-project-path">{{ project.worktree }}</span>
            <ComboboxItemIndicator class="kilo-project-check"><Check :size="15" /></ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>

<!-- Unscoped: Reka's teleported content does not receive scoped-style attributes. -->
<style>
.kilo-project-anchor {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  transition: border-color 0.12s, background 0.12s;
}
.kilo-project-anchor:hover {
  background: var(--bg-hover);
}
.kilo-project-anchor:focus-within {
  border-color: var(--accent);
}
.kilo-project-icon {
  color: var(--text-muted);
  flex: none;
}
.kilo-project-input {
  width: 110px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-overflow: ellipsis;
}
.kilo-project-input::placeholder {
  color: var(--text-muted);
}
.kilo-project-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  background: transparent;
  border: none;
  padding: 2px;
  flex: none;
}
.kilo-project-chevron:hover {
  color: var(--text);
}
.kilo-project-menu {
  width: 340px;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.kilo-project-scroll {
  max-height: min(60vh, 420px);
  overflow: auto;
  padding: 6px;
}
.kilo-project-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  column-gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  outline: none;
  user-select: none;
}
.kilo-project-option[data-highlighted] {
  background: var(--bg-hover);
}
.kilo-project-option.is-active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.kilo-project-name {
  grid-column: 1;
  font-size: 13.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kilo-project-path {
  grid-column: 1;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kilo-project-check {
  grid-column: 2;
  grid-row: 1 / span 2;
  justify-self: center;
  color: var(--accent);
  display: inline-flex;
}
.kilo-project-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px;
}
</style>