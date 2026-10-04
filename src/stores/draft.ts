import { ref } from "vue"

/** Shared composer draft so empty-state suggestions can prefill the input. */
export const draft = ref("")

export function useDraft() {
  return draft
}