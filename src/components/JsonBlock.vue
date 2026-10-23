<script setup lang="ts">
import { computed } from "vue"
import hljs from "highlight.js/lib/common"

/**
 * A read-only code block with syntax highlighting, used for tool inputs and
 * outputs. JSON is highlighted only when it actually parses, so partially
 * streamed tool arguments (which are invalid JSON until they complete) fall
 * back to plain text.
 */
const props = defineProps<{ text: string; language?: string }>()

const html = computed<string | null>(() => {
  const language = props.language ?? "json"
  const source = props.text ?? ""
  if (!source) return null
  try {
    if (language === "json") JSON.parse(source)
    return hljs.highlight(source, { language }).value
  } catch {
    return null
  }
})
</script>

<template>
  <pre class="code-view"><code v-if="html" class="hljs" v-html="html"></code><code v-else>{{ text }}</code></pre>
</template>

<style scoped>
.code-view {
  margin: 0;
  padding: 10px;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 320px;
  color: #d6deeb;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.code-view code {
  font-family: inherit;
  font-size: inherit;
  background: transparent;
}
</style>
