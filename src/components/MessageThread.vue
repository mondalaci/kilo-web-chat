<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import MessageItem from "./MessageItem.vue"
import Spinner from "./Spinner.vue"
import { useChat } from "@/stores/chat"

const { messages, loading } = useChat()

const viewport = ref<HTMLElement | null>(null)
const pinned = ref(true)

const lastAssistantID = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].info.role === "assistant") return messages.value[i].info.id
  }
  return null
})

function onScroll() {
  const el = viewport.value
  if (!el) return
  pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 100
}

async function scrollToBottom() {
  await nextTick()
  const el = viewport.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(messages, () => {
  if (pinned.value) void scrollToBottom()
}, { deep: true })

watch(loading, (value) => {
  if (!value) void scrollToBottom()
})
</script>

<template>
  <div ref="viewport" class="thread" @scroll="onScroll">
    <div v-if="loading" class="loading"><Spinner :size="18" /></div>

    <template v-else>
      <MessageItem
        v-for="message in messages"
        :key="message.info.id"
        :message="message"
        :streaming="message.info.id === lastAssistantID && !(message.info as { time?: { completed?: number } }).time?.completed"
      />
    </template>

    <div class="spacer"></div>
  </div>
</template>

<style scoped>
.thread {
  flex: 1;
  overflow-y: auto;
  padding: 20px 20px 0;
  scroll-behavior: smooth;
  /* Reserve a symmetric gutter so a scrollbar does not shift the centered
     content column off the composer's center. */
  scrollbar-gutter: stable both-edges;
}
.loading {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--text-muted);
}
.spacer {
  height: 12px;
}
</style>