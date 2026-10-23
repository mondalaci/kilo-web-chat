function readParam(name: string): string | null {
  try {
    return new URL(window.location.href).searchParams.get(name)
  } catch {
    return null
  }
}

/** Session id encoded in the URL, so the same URL opens the same chat. */
export function readSessionParam(): string | null {
  return readParam("session")
}

/** Initial composer text, prefilled from `?query=`. */
export function readQueryParam(): string | null {
  return readParam("query")
}

/** Agent/mode name to preselect, from `?agent=`. */
export function readAgentParam(): string | null {
  return readParam("agent")
}

/**
 * Project (location directory) to open, from `?project=`.
 *
 * One-time, like `?query=`: a launcher shortcut uses it to drop the app into a
 * project for one visit, without moving the project the app remembers.
 */
export function readProjectParam(): string | null {
  return readParam("project")
}

/** Whether the initial query should be sent automatically, from `?submit=`. */
export function readAutoSubmitParam(): boolean {
  const value = readParam("submit")
  if (value === null) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "" || normalized === "1" || normalized === "true" || normalized === "yes"
}

/** Drop one-time prompt params so a reload does not resend the query. */
export function clearPromptParams() {
  dropParams(["query", "agent", "submit"])
}

/** Drop the one-time `?project=` so a reload returns to the remembered project. */
export function clearProjectParam() {
  dropParams(["project"])
}

function dropParams(names: string[]) {
  try {
    const url = new URL(window.location.href)
    for (const name of names) url.searchParams.delete(name)
    history.replaceState(history.state, "", url.toString())
  } catch {
    /* history unavailable */
  }
}

export function writeSessionParam(id: string | null, replace = true) {
  try {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set("session", id)
    else url.searchParams.delete("session")
    const state = { session: id }
    if (replace) history.replaceState(state, "", url.toString())
    else history.pushState(state, "", url.toString())
  } catch {
    /* history unavailable */
  }
}
