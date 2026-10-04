import type { Credentials } from "@/api/client"
import type { InstanceInfo } from "@/api/discovery"
import { useChat } from "./chat"
import { useConnection } from "./connection"
import { requestComposerFocus } from "./draft"
import { useLive } from "./live"
import { useServer } from "./server"
import { useSessions } from "./sessions"

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
    await server.load(client, origin, server.savedDirectory(origin))
    await sessions.load(client, server.directory.value)
    await live.start(client, server.directory.value)
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
    await chat.open(client, sessionID, server.directory.value)
  }

  /** Switch the active project (directory) and reload everything scoped to it. */
  async function switchProject(directory: string) {
    const client = connection.client.value
    if (!client) return
    if (server.directory.value === directory) return
    live.stop()
    chat.reset()
    sessions.reset()
    server.setDirectory(directory)
    await server.load(client, connection.connected.value?.origin ?? "", directory)
    await sessions.load(client, server.directory.value)
    await live.start(client, server.directory.value)
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

  type FilePartInput = { type: "file"; mime: string; url: string; filename?: string }

async function sendMessage(text: string, files: FilePartInput[] = []) {
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
    const parts = [...files, ...(content ? [{ type: "text" as const, text: content }] : [])]
    await chat.send(
      client,
      sessionID,
      {
        parts,
        model: server.selectedModel.value,
        agent: server.selectedAgent.value,
      },
      server.directory.value,
    )
  }

  async function abort() {
    const client = connection.client.value
    const sessionID = sessions.currentID.value
    if (!client || !sessionID) return
    await chat.abort(client, sessionID, server.directory.value)
  }

  async function removeSession(sessionID: string) {
    const client = connection.client.value
    if (!client) return
    await sessions.remove(client, sessionID, server.directory.value)
    if (!sessions.currentID.value && sessions.sorted.value[0]) {
      await selectSession(sessions.sorted.value[0].id)
    }
  }

  async function renameSession(sessionID: string, title: string) {
    const client = connection.client.value
    if (!client) return
    await sessions.rename(client, sessionID, title, server.directory.value)
  }

  async function replyPermission(requestID: string, reply: "once" | "always" | "reject") {
    const client = connection.client.value
    if (!client) return
    await chat.replyPermission(client, requestID, reply, server.directory.value)
  }

  async function replyQuestion(requestID: string, answers: string[][]) {
    const client = connection.client.value
    if (!client) return
    await chat.replyQuestion(client, requestID, answers, server.directory.value)
  }

  async function rejectQuestion(requestID: string) {
    const client = connection.client.value
    if (!client) return
    await chat.rejectQuestion(client, requestID, server.directory.value)
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
    newChat,
    sendMessage,
    abort,
    removeSession,
    renameSession,
    replyPermission,
    replyQuestion,
    rejectQuestion,
  }
}

export type AppStore = ReturnType<typeof useApp>