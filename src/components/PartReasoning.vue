<script setup lang="ts">
import { computed, ref } from "vue"
import { Brain, ChevronRight } from "lucide-vue-next"
import type { ReasoningPart } from "@/api/types"
import Spinner from "./Spinner.vue"

const props = defineProps<{ part: ReasoningPart }>()
const open = ref(true)
const streaming = computed(() => !props.part.time?.end)
</script>

<template>
  <div class="reasoning">
    <button class="head" @click="open = !open">
      <ChevronRight :size="14" class="chev" :class="{ open }" />
      <Brain :size="14" />
      <span>Reasoning</span>
      <Spinner v-if="streaming" :size="12" />
    </button>
    <div v-show="open" class="body">{{ part.text }}</div>
  </div>
</template>

<style scoped>
.reasoning {
  margin: 6px 0;
  border-left: 2px solid var(--border);
  padding-left: 10px;
}
.head {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: transparent;
  border: none;
  padding: 2px 0;
  color: var(--text-muted);
  font-size: 12.5px;
  font-weight: 500;
}
.head:hover {
  color: var(--text);
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
</style>