<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { marked } from "marked"
import DOMPurify from "dompurify"
import hljs from "highlight.js/lib/common"

const props = defineProps<{ text: string }>()
const root = ref<HTMLElement | null>(null)

marked.setOptions({ gfm: true, breaks: true })

const html = computed(() => {
  const raw = marked.parse(props.text ?? "", { async: false }) as string
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "rel"] })
})

function highlight() {
  if (!root.value) return
  root.value.querySelectorAll("pre code").forEach((block) => {
    try {
      hljs.highlightElement(block as HTMLElement)
    } catch {
      /* unsupported language */
    }
  })
}

onMounted(highlight)
watch(html, () => requestAnimationFrame(highlight))
</script>

<template>
  <div ref="root" class="markdown" v-html="html"></div>
</template>