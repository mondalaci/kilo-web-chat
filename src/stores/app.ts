import type { Credentials, PromptFileInput } from "@/api/client"
import type { InstanceInfo } from "@/api/discovery"
import type { FormAnswer, FormInfo, Model } from "@/api/types"
import { useChat } from "./chat"
import { useConnection } from "./connection"
import { draft, requestComposerFocus } from "./draft"
import { useLive } from "./live"
import { loadRuntimeConfig } from "./runtimeConfig"
import { toModelRef, useServer } from "./server"
import { useSessions } from "./sessions"
import {
  clearPromptParams,
  readAgentParam,
  readAutoSubmitParam,
  readQueryParam,
  readSessionParam,
  writeSessionParam,
} from "@/utils/url"

/** A chat link that reopens this session in the current UI. */
export function sessionURL(sessionID: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set("session", sessionID)
  return url.toString()
}

export function useApp() {
  const connection = useConnection()
  const server = useServer()
  const sessions = useSessions()
  const chat = useChat()
  const live = useLive()

  async function connect(info: InstanceInfo, credentials?: Credentials) {
    live.stop()
    chat.reset()
    sessions.reset()
    server.reset()

    server.applySavedPrefs(info.origin)

    const ok = await connection.connect(info, credentials)
    const client = connection.client.value
    if (!ok || !client) return false

    try {
      const origin = connection.connected.value?.origin ?? info.origin
      // Fall back to the server's own default location when no project has been
      // chosen for this server yet.
      const saved = server.savedDirectory(origin)
      const directory = saved ?? (await client.locationInfo().catch(() => null))?.directory
      await server.load(client, origin, directory)
      await sessions.load(client, server.directory.value)
      live.start(client, server.directory.value)
      await openSessionFromUrl()
      await applyRuntimeDefaults()
      await applyLinkParams()
      return true
    } catch (error) {
      live.stop()
      chat.reset()
      sessions.reset()
      server.reset()
      connection.disconnect()
      connection.connectError.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  function disconnect() {
    live.stop()
    chat.reset()
    sessions.reset()
    server.reset()
    connection.disconnect()
  }

  async function selectSession(sessionID: string) {
    const client = connection.client.value
    if (!client) return
    sessions.currentID.value = sessionID
    writeSessionParam(sessionID, readSessionParam() === sessionID)
    // Refresh the session info so the header reflects fields the list omits.
    const info = await client.getSession(sessionID).catch(() => null)
    if (info) {
      sessions.upsert(info)
      server.applySession(info)
    }
    await chat.open(client, sessionID, server.directory.value)
  }

  /** Open a session by id, switching project first if it lives elsewhere. */
  async function openSessionByID(sessionID: string) {
    const client = connection.client.value
    if (!client) return false
    const info = await client.getSession(sessionID).catch(() => null)
    if (!info) return false
    const directory = info.location?.directory
    if (directory && directory !== server.directory.value) await switchProject(directory)
    await selectSession(sessionID)
    return true
  }

  /** Apply the session id from the current URL (used on load and back/forward). */
  async function openSessionFromUrl() {
    const id = readSessionParam()
    if (id) await openSessionByID(id)
  }

  /**
   * Apply the runtime config's `defaultAgent` (from `opencode-web-chat.json`)
   * once the agent list is known. It overrides the last-used saved agent, but a
   * `?agent=` GET param applied afterwards still takes precedence.
   */
  async function applyRuntimeDefaults() {
    const { defaultAgent } = await loadRuntimeConfig()
    if (defaultAgent && server.modes.value.some((agent) => agent.id === defaultAgent)) {
      await setAgent(defaultAgent)
    }
  }

  /**
   * Apply one-time link params (`?agent=`, `?query=`, `?submit=`) after a
   * connection is established. The agent is only applied when it exists, and the
   * query is prefilled into the composer; with `submit` it is sent right away
   * (creating a new chat if none is open) and the params are cleared so a reload
   * does not resend it.
   */
  async function applyLinkParams() {
    const agent = readAgentParam()
    if (agent && server.modes.value.some((item) => item.id === agent)) {
      await setAgent(agent)
    }

    const query = readQueryParam()
    if (query !== null) draft.value = query

    if (!readAutoSubmitParam()) return
    const text = draft.value.trim()
    clearPromptParams()
    if (!text) return
    await sendMessage(text)
    draft.value = ""
  }

  /** Switch the active project (location) and reload everything scoped to it. */
  async function switchProject(directory: string) {
    const client = connection.client.value
    if (!client) return
    if (server.directory.value === directory) return
    chat.reset()
    sessions.reset()
    // The open chat (if any) belongs to the previous project; drop it from the
    // URL too so a reload does not jump straight back to it.
    writeSessionParam(null)
    server.setDirectory(directory)
    await server.load(client, connection.connected.value?.origin ?? "", directory)
    await sessions.load(client, server.directory.value)
    live.setDirectory(server.directory.value)
  }

  async function newChat() {
    const client = connection.client.value
    if (!client) return null
    const session = await sessions.create(
      client,
      { agent: server.selectedAgent.value, model: server.selectedModel.value ?? undefined },
      server.directory.value,
    )
    await selectSession(session.id)
    requestComposerFocus()
    return session
  }

  /**
   * Select an agent. When a chat is open the choice is applied to that session
   * (v2 keeps agent/model on the session, not on each message).
   */
  async function setAgent(name: string) {
    server.setAgentLocal(name)
    const client = connection.client.value
    const sessionID = sessions.currentID.value
    if (!client || !sessionID) return
    await client.switchAgent(sessionID, name).catch(() => undefined)
    const info = sessions.sessions.value.find((item) => item.id === sessionID)
    if (info) sessions.upsert({ ...info, agent: name })
  }

  /** Select a model (optionally with a variant), applying it to the open chat. */
  async function setModel(model: Model | { providerID: string; modelID?: string; id?: string; variant?: string }, variant?: string) {
    const ref = toModelRef(model as Model)
    const next = variant ? { ...ref, variant } : ref
    server.setModelLocal(next)
    const client = connection.client.value
    const sessionID = sessions.currentID.value
    if (!client || !sessionID) return
    await client.switchModel(sessionID, next).catch(() => undefined)
    const info = sessions.sessions.value.find((item) => item.id === sessionID)
    if (info) sessions.upsert({ ...info, model: next })
  }

  /** Switch the reasoning-effort variant of the current model. */
  async function setVariant(variant: string) {
    const current = server.selectedModel.value
    if (!current) return
    await setModel(current, variant)
  }

  async function sendMessage(text: string, files: PromptFileInput[] = []) {
    const client = connection.client.value
    if (!client) return
    const content = text.trim()
    if (!content && files.length === 0) return
    let sessionID = sessions.currentID.value
    if (!sessionID) {
      const session = await newChat()
      if (!session) return
      sessionID = session.id
    }
    await chat.send(client, sessionID, { text: content, files })
  }

  async function abort() {
    const client = connection.client.value
    const sessionID = sessions.currentID.value
    if (!client || !sessionID) return
    await chat.abort(client, sessionID)
  }

  async function removeSession(sessionID: string) {
    const client = connection.client.value
    if (!client) return
    await sessions.remove(client, sessionID)
    if (!sessions.currentID.value && sessions.sorted.value[0]) {
      await selectSession(sessions.sorted.value[0].id)
    }
  }

  async function renameSession(sessionID: string, title: string) {
    const client = connection.client.value
    if (!client) return
    await sessions.rename(client, sessionID, title)
  }

  async function replyPermission(sessionID: string, requestID: string, decision: "once" | "always" | "reject") {
    const client = connection.client.value
    if (!client) return
    await chat.replyPermission(client, requestID, sessionID, decision)
  }

  async function replyForm(form: FormInfo, answer: FormAnswer) {
    const client = connection.client.value
    if (!client) return
    await chat.replyForm(client, form.sessionID, form.id, answer)
  }

  async function cancelForm(form: FormInfo) {
    const client = connection.client.value
    if (!client) return
    await chat.cancelForm(client, form.sessionID, form.id)
  }

  /** The openai-compatible key the server holds for an integration (TTS). */
  async function integrationKey(integrationID: string): Promise<string | null> {
    const client = connection.client.value
    if (!client) return null
    return client.credentialKey(integrationID)
  }

  return {
    connection,
    server,
    sessions,
    chat,
    live,
    connect,
    disconnect,
    selectSession,
    switchProject,
    openSessionFromUrl,
    openSessionByID,
    newChat,
    sendMessage,
    abort,
    removeSession,
    renameSession,
    setAgent,
    setModel,
    setVariant,
    replyPermission,
    replyForm,
    cancelForm,
    integrationKey,
  }
}

export type AppStore = ReturnType<typeof useApp>
