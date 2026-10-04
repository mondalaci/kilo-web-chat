/** Session id encoded in the URL, so the same URL opens the same chat. */
export function readSessionParam(): string | null {
  try {
    return new URL(window.location.href).searchParams.get("session")
  } catch {
    return null
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
