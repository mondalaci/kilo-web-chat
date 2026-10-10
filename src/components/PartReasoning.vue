<script setup lang="ts">
import { computed, ref } from "vue"
import { ChevronRight } from "lucide-vue-next"
import type { ReasoningPart } from "@/api/types"
import Spinner from "./Spinner.vue"

const props = defineProps<{ part: ReasoningPart }>()
const open = ref(true)
const streaming = computed(() => !props.part.time?.end)
</script>

<template>
  <div class="reasoning">
    <button
      class="head"
      :aria-expanded="open"
      :title="open ? 'Collapse reasoning' : 'Expand reasoning'"
      aria-label="Reasoning"
      @click="open = !open"
    >
      <Spinner v-if="streaming" :size="14" />
      <ChevronRight v-else :size="16" class="chev" :class="{ open }" />
    </button>
    <div v-show="open" class="body">{{ part.text }}</div>
  </div>
</template>

<style scoped>
.reasoning {
  position: relative;
  margin: 6px 0;
  border-left: 2px solid var(--border);
  padding-left: 10px;
}
/* Bare, subtle toggle in the right gutter, mirroring the assistant avatar on the left. */
.head {
  position: absolute;
  top: 0;
  left: calc(100% + 10px);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-faint);
  opacity: 0.6;
  transition: color 0.12s, opacity 0.12s;
}
.head:hover {
  color: var(--text);
  opacity: 1;
}
.chev {
  transition: transform 0.15s;
}
.chev.open {
  transform: rotate(90deg);
}
.body {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 100px;
  overflow-y: auto;
}
/* No right gutter on narrow viewports: fall back to overlaying the content. */
@media (max-width: 880px) {
  .head {
    left: auto;
    right: 0;
  }
}
</style>
