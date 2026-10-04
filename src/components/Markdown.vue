<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { marked } from "marked"
import DOMPurify from "dompurify"
import hljs from "highlight.js/lib/common"

const props = defineProps<{ text: string; streaming?: boolean }>()
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

/* ---------------------------------- Mermaid --------------------------------- */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null

async function getMermaid() {
  mermaidPromise ??= import("mermaid").then((mod) => mod.default)
  const mermaid = await mermaidPromise
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
  })
  return mermaid
}

let renderToken = 0
async function renderMermaid() {
  // While a message is still streaming, mermaid source is incomplete; show the
  // code block and render once the message is done.
  if (props.streaming || !root.value) return
  const nodes = Array.from(root.value.querySelectorAll<HTMLElement>("pre > code.language-mermaid, pre > code.lang-mermaid"))
  if (nodes.length === 0) return
  const token = ++renderToken
  try {
    const mermaid = await getMermaid()
    for (const node of nodes) {
      if (token !== renderToken) return
      const pre = node.closest("pre")
      if (!pre) continue
      const source = node.textContent ?? ""
      try {
        const { svg } = await mermaid.render(`mermaid-${token}-${Math.random().toString(36).slice(2)}`, source)
        const container = document.createElement("div")
        container.className = "mermaid-diagram"
        container.innerHTML = svg
        pre.replaceWith(container)
      } catch {
        // Invalid/incomplete diagram: leave the highlighted code visible.
        pre.dataset.mermaidError = "true"
      }
    }
  } catch {
    /* mermaid failed to load */
  }
}

function renderAll() {
  highlight()
  void renderMermaid()
}

onMounted(renderAll)
watch(html, () => requestAnimationFrame(renderAll))
watch(
  () => props.streaming,
  () => requestAnimationFrame(renderAll),
)
</script>

<template>
  <div ref="root" class="markdown" v-html="html"></div>
</template>