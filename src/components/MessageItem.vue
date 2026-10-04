<script setup lang="ts">
import { computed } from "vue"
import { File as FileIcon } from "lucide-vue-next"
import type { FilePart, MessageWithParts, Part, TextPart } from "@/api/types"
import { formatCost, formatTokens } from "@/utils/format"
import Markdown from "./Markdown.vue"
import PartReasoning from "./PartReasoning.vue"
import PartTool from "./PartTool.vue"

const props = defineProps<{ message: MessageWithParts; streaming?: boolean }>()

const isUser = computed(() => props.message.info.role === "user")

const contentParts = computed<Part[]>(() =>
  props.message.parts.filter((part) => {
    if (part.type === "text") {
      const text = part as TextPart
      if (text.synthetic || text.ignored || !text.text.trim()) return false
    }
    return true
  }),
)

const errorMessage = computed(() => {
  const info = props.message.info
  if (info.role !== "assistant" || !info.error) return null
  const error = info.error as { data?: { message?: string }; name?: string }
  return error.data?.message ?? error.name ?? "The model returned an error."
})

const meta = computed(() => {
  const info = props.message.info
  if (info.role !== "assistant") return null
  const tokens = info.tokens
  const total = tokens ? (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) : 0
  return {
    model: info.modelID,
    tokens: total,
    cost: info.cost ?? 0,
  }
})

function isImage(part: FilePart) {
  return part.mime?.startsWith("image/") && (part.url?.startsWith("data:") || part.url?.startsWith("http"))
}
</script>

<template>
  <div class="message" :class="isUser ? 'user' : 'assistant'">
    <div v-if="!isUser" class="avatar" aria-hidden="true">K</div>
    <div class="bubble" :class="isUser ? 'user-bubble' : 'assistant-bubble'">
      <template v-for="part in contentParts" :key="part.id">
        <Markdown v-if="part.type === 'text' && !isUser" :text="(part as TextPart).text" />
        <p v-else-if="part.type === 'text' && isUser" class="user-text">{{ (part as TextPart).text }}</p>

        <PartReasoning v-else-if="part.type === 'reasoning' && !isUser" :part="part" />
        <PartTool v-else-if="part.type === 'tool' && !isUser" :part="part" />

        <div v-else-if="part.type === 'file'" class="file">
          <img v-if="isImage(part as FilePart)" :src="(part as FilePart).url" :alt="(part as FilePart).filename ?? 'image'" />
          <a v-else class="file-chip" :href="(part as FilePart).url" target="_blank" rel="noreferrer">
            <FileIcon :size="14" />
            {{ (part as FilePart).filename ?? (part as FilePart).mime }}
          </a>
        </div>
      </template>

      <div v-if="streaming && !isUser" class="caret"></div>

      <div v-if="errorMessage" class="error">{{ errorMessage }}</div>

      <div v-if="meta && !streaming" class="meta">
        <span>{{ meta.model }}</span>
        <span v-if="meta.tokens">· {{ formatTokens(meta.tokens) }} tokens</span>
        <span v-if="meta.cost">· {{ formatCost(meta.cost) }}</span>
      </div>
    </div>
    <div v-if="isUser" class="avatar user-avatar" aria-hidden="true">You</div>
  </div>
</template>

<style scoped>
.message {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  max-width: var(--content-width);
  margin: 0 auto;
  width: 100%;
}
.message.user {
  justify-content: flex-end;
}
.message.assistant {
  justify-content: flex-start;
}
.avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  background: var(--accent);
  color: var(--accent-text);
  margin-top: 2px;
}
.user-avatar {
  background: var(--bg-active);
  color: var(--text-muted);
  font-size: 10px;
}
.bubble {
  min-width: 0;
  max-width: 100%;
}
.assistant-bubble {
  flex: 1;
}
.user-bubble {
  background: var(--bubble-user);
  border-radius: var(--radius-lg);
  padding: 9px 14px;
  max-width: 80%;
}
.user-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.file {
  margin: 6px 0;
}
.file img {
  max-width: 100%;
  max-height: 360px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  font-size: 12.5px;
  text-decoration: none;
}
.caret {
  display: inline-block;
  width: 8px;
  height: 15px;
  background: var(--text);
  vertical-align: text-bottom;
  animation: kilo-blink 1s step-start infinite;
}
@keyframes kilo-blink {
  50% {
    opacity: 0;
  }
}
.error {
  margin-top: 8px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 13px;
}
.meta {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-faint);
  display: flex;
  gap: 5px;
}
</style>