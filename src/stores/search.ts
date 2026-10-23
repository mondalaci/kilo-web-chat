import { ref } from "vue"
import { archiveOpen } from "./archive"

/** Whether the dedicated conversation search page is open. */
export const searchOpen = ref(false)

export function openSearch() {
  // The sidebar holds one view at a time, so the archive steps aside.
  archiveOpen.value = false
  searchOpen.value = true
}

export function closeSearch() {
  searchOpen.value = false
}
