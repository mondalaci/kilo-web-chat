<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue"
import { ArrowUp, Folder, Square } from "lucide-vue-next"
import AgentSelector from "./AgentSelector.vue"
import ModelSelector from "./ModelSelector.vue"
import { useApp } from "@/stores/app"
import { draft } from "@/stores/draft"
import { useServer } from "@/stores/server"

const app = useApp()
const { sending, isBusy } = app.chat
const { abort, sendMessage } = app
const { directory } = useServer()

const textarea = ref<HTMLTextAreaElement | null>(null)

function resize() {
  const el = textarea.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 320)}px`
}

watch(draft, () => nextTick(resize))
onMounted(resize)

async function submit() {
  const text = draft.value
  if (!text.trim() || sending.value) return
  draft.value = ""
  await nextTick(resize)
  try {
    await sendMessage(text)
  } catch {
    draft.value = text
  }
}

async function stop() {
  await abort()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void submit()
  }
}

const projectName = () => directory.value?.split("/").filter(Boolean).pop()
</script>

<template>
  <div class="composer-wrap">
    <div class="composer">
      <textarea
        ref="textarea"
        v-model="draft"
        class="input"
        rows="1"
        placeholder="Message Kilo Code…"
        spellcheck="false"
        @keydown="onKeydown"
      />
      <div class="bar">
        <div class="bar-left">
          <AgentSelector />
          <ModelSelector />
        </div>
        <div class="bar-right">
          <span v-if="directory" class="project" :title="directory">
            <Folder :size="13" />
            {{ projectName() }}
          </span>
          <button v-if="isBusy" class="send stop" title="Stop" @click="stop">
            <Square :size="14" fill="currentColor" />
          </button>
          <button v-else class="send" :disabled="!draft.trim() || sending" title="Send" @click="submit">
            <ArrowUp :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  padding: 8px 20px 14px;
  max-width: var(--content-width);
  margin: 0 auto;
  width: 100%;
}
.composer {
  border: 1px solid var(--border);
  background: var(--bg-input);
  border-radius: var(--radius-lg);
  padding: 10px 12px 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
  transition: border-color 0.12s;
}
.composer:focus-within {
  border-color: var(--border-strong);
}
.input {
  width: 100%;
  max-height: 320px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 15px;
  line-height: 1.5;
  padding: 2px 4px 8px;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.project {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--text-muted);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.send {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: var(--accent-text);
  display: grid;
  place-items: center;
  transition: background 0.12s, opacity 0.12s;
}
.send:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send:disabled {
  opacity: 0.4;
  cursor: default;
}
.send.stop {
  background: var(--bg-active);
  color: var(--text);
}
</style>