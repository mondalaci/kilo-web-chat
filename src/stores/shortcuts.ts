import { reactive, ref } from "vue"

/**
 * Keyboard-shortcut state.
 *
 * Holding the modifier (`Alt`) reveals key badges on the controls they trigger,
 * mirroring the "hold Cmd to see shortcuts" pattern. Actions that need to reach
 * a specific component are dispatched through `openRequests` counters that the
 * component watches.
 */
export const shortcutsVisible = ref(false)

export const openRequests = reactive({ model: 0, agent: 0, project: 0, sessions: 0, effort: 0 })

export function requestOpen(which: "model" | "agent" | "project" | "sessions" | "effort") {
  openRequests[which] += 1
}

/** Key codes (layout/modifier independent) for the shortcuts. */
export const shortcutKeys = {
  model: "KeyM",
  agent: "KeyA",
  project: "KeyP",
  newChat: "KeyN",
  focusChat: "KeyC",
  sessions: "KeyS",
  effort: "KeyE",
} as const
