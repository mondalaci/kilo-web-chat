import { computed, ref } from "vue"
import type { ServerClient, PromptFileInput } from "@/api/client"
import type {
  AssistantContent,
  AssistantReasoning,
  AssistantText,
  AssistantTool,
  FormAnswer,
  FormInfo,
  PermissionRequest,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStatus,
  V2Event,
} from "@/api/types"

/** How long streaming updates are coalesced before a full reconcile. */
const RECONCILE_DEBOUNCE_MS = 200

const messages = ref<SessionMessageInfo[]>([])
const status = ref<SessionStatus>({ type: "idle" })
const loading = ref(false)
const sending = ref(false)
const error = ref<string | null>(null)
const permissions = ref<PermissionRequest[]>([])
const forms = ref<FormInfo[]>([])
const currentSessionID = ref<string | null>(null)

/** Bumped on every user send so the view forces a re-pin and scroll to bottom. */
const scrollToBottomRequest = ref(0)

/**
 * Live content assembly for streaming assistant messages.
 *
 * v2 streams content *block* by block: `session.text.started(ordinal)` opens a
 * text block, `session.text.delta(ordinal, delta)` appends to it and
 * `session.text.ended(ordinal, text)` finalizes it. Reasoning and tool calls
 * follow the same shape. This mirrors the server's own `content` array so the
 * view can render partial output, and a debounced reconcile replaces the
 * assembled value with the authoritative one at the end of each step.
 */
interface LiveContent {
  content: AssistantContent[]
  text: Map<number, AssistantText>
  reasoning: Map<number, AssistantReasoning>
  tools: Map<string, AssistantTool>
}

const live = new Map<string, LiveContent>()

let reconcileTimer: ReturnType<typeof setTimeout> | null = null
let reconcileContext: { client: ServerClient; sessionID: string } | null = null

function findMessage(messageID: string) {
  return messages.value.find((item) => item.id === messageID) as SessionMessageAssistant | undefined
}

/** Index a message's persisted content so later deltas update the right block. */
function seed(messagesToSeed: SessionMessageInfo[]) {
  for (const message of messagesToSeed) {
    if (message.type !== "assistant") continue
    const entry: LiveContent = { content: message.content, text: new Map(), reasoning: new Map(), tools: new Map() }
    let textOrdinal = 0
    let reasoningOrdinal = 0
    for (const block of message.content) {
      if (block.type === "text") entry.text.set(textOrdinal++, block)
      else if (block.type === "reasoning") entry.reasoning.set(reasoningOrdinal++, block)
      else if (block.type === "tool") entry.tools.set(block.id, block)
    }
    live.set(message.id, entry)
  }
}

function liveFor(messageID: string): LiveContent | undefined {
  const existing = live.get(messageID)
  if (existing) return existing
  const message = findMessage(messageID)
  if (!message) return undefined
  seed([message])
  return live.get(messageID)
}

/** Create the assistant message a stream belongs to, if it is not known yet. */
function ensureAssistant(messageID: string, agent?: string, model?: SessionMessageAssistant["model"]) {
  const existing = findMessage(messageID)
  if (existing) return existing
  const message: SessionMessageAssistant = {
    id: messageID,
    time: { created: Date.now() },
    type: "assistant",
    agent: agent ?? "",
    model: model ?? { id: "", providerID: "" },
    content: [],
  }
  messages.value = [...messages.value, message]
  live.set(messageID, { content: message.content, text: new Map(), reasoning: new Map(), tools: new Map() })
  return message
}

function pushBlock(message: SessionMessageAssistant, block: AssistantContent) {
  // `content` is the array the live entry points at, so a push is enough.
  message.content.push(block)
}

/**
 * The arguments of a tool call as an object. While the call is still streaming
 * they arrive as a partial JSON string, which may not parse yet.
 */
type ToolInput = Extract<AssistantTool["state"], { status: "running" }>["input"]

function toolInput(state: AssistantTool["state"]): ToolInput {
  if (state.status === "streaming") {
    try {
      const parsed = JSON.parse(state.input)
      return parsed && typeof parsed === "object" ? (parsed as ToolInput) : {}
    } catch {
      return {}
    }
  }
  return state.input as ToolInput
}

function appendText(messageID: string, ordinal: number, delta: string) {
  const message = findMessage(messageID)
  if (!message) return
  const entry = liveFor(messageID) ?? { content: message.content, text: new Map(), reasoning: new Map(), tools: new Map() }
  let block = entry.text.get(ordinal)
  if (!block) {
    block = { type: "text", text: "" }
    entry.text.set(ordinal, block)
    pushBlock(message, block)
  }
  block.text += delta
}

function setText(messageID: string, ordinal: number, text: string) {
  const message = findMessage(messageID)
  if (!message) return
  const entry = liveFor(messageID) ?? { content: message.content, text: new Map(), reasoning: new Map(), tools: new Map() }
  let block = entry.text.get(ordinal)
  if (!block) {
    block = { type: "text", text: "" }
    entry.text.set(ordinal, block)
    pushBlock(message, block)
  }
  block.text = text
}

function appendReasoning(messageID: string, ordinal: number, delta: string) {
  const message = findMessage(messageID)
  if (!message) return
  const entry = liveFor(messageID) ?? { content: message.content, text: new Map(), reasoning: new Map(), tools: new Map() }
  let block = entry.reasoning.get(ordinal)
  if (!block) {
    block = { type: "reasoning", text: "", time: { created: Date.now() } }
    entry.reasoning.set(ordinal, block)
    pushBlock(message, block)
  }
  block.text += delta
}

function setReasoning(messageID: string, ordinal: number, text: string) {
  const message = findMessage(messageID)
  if (!message) return
  const entry = liveFor(messageID) ?? { content: message.content, text: new Map(), reasoning: new Map(), tools: new Map() }
  let block = entry.reasoning.get(ordinal)
  if (!block) {
    block = { type: "reasoning", text: "", time: { created: Date.now() } }
    entry.reasoning.set(ordinal, block)
    pushBlock(message, block)
  }
  block.text = text
  block.time = { ...(block.time ?? { created: Date.now() }), completed: Date.now() }
}

function toolBlock(messageID: string, id: string, name?: string): { message: SessionMessageAssistant; block: AssistantTool } | null {
  const message = findMessage(messageID)
  if (!message) return null
  const entry = liveFor(messageID) ?? { content: message.content, text: new Map(), reasoning: new Map(), tools: new Map() }
  let block = entry.tools.get(id)
  if (!block) {
    block = {
      type: "tool",
      id,
      name: name ?? "",
      state: { status: "streaming", input: "" },
      time: { created: Date.now() },
    }
    entry.tools.set(id, block)
    pushBlock(message, block)
  }
  if (name) block.name = name
  return { message, block }
}

export function useChat() {
  const isBusy = computed(() => status.value.type === "busy" || status.value.type === "retry")

  const pendingPermissions = computed(() =>
    permissions.value.filter((request) => request.sessionID === currentSessionID.value),
  )
  const pendingForms = computed(() => forms.value.filter((form) => form.sessionID === currentSessionID.value))

  function setMessages(next: SessionMessageInfo[]) {
    messages.value = next
    live.clear()
    seed(next)
  }

  async function open(client: ServerClient, sessionID: string, directory?: string | null) {
    currentSessionID.value = sessionID
    loading.value = true
    error.value = null
    setMessages([])
    reconcileContext = { client, sessionID }
    try {
      const [list, perms, pendingForms, active] = await Promise.all([
        client.allMessages(sessionID),
        client.pendingPermissions(directory).catch(() => [] as PermissionRequest[]),
        client.pendingForms(directory).catch(() => [] as FormInfo[]),
        client.activeSessions().catch(() => ({} as Record<string, SessionStatus>)),
      ])
      // Ignore a response for a session the user already navigated away from.
      if (currentSessionID.value !== sessionID) return
      setMessages(list)
      permissions.value = perms
      forms.value = pendingForms
      const running = active[sessionID]
      status.value = running ?? { type: "idle" }
    } catch (err) {
      if (currentSessionID.value === sessionID) error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (currentSessionID.value === sessionID) loading.value = false
    }
  }

  /** Re-fetch the open session's messages, coalescing rapid callers. */
  function scheduleReconcile(client: ServerClient, sessionID: string) {
    reconcileContext = { client, sessionID }
    if (reconcileTimer) return
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null
      void reconcileNow()
    }, RECONCILE_DEBOUNCE_MS)
  }

  async function reconcileNow() {
    const context = reconcileContext
    if (!context || context.sessionID !== currentSessionID.value) return
    try {
      const list = await context.client.allMessages(context.sessionID)
      if (currentSessionID.value !== context.sessionID) return
      setMessages(list)
    } catch {
      /* keep the assembled view when the reconcile fails */
    }
  }

  async function send(client: ServerClient, sessionID: string, body: { text: string; files?: PromptFileInput[] }) {
    sending.value = true
    error.value = null
    scrollToBottomRequest.value++
    reconcileContext = { client, sessionID }
    try {
      await client.prompt(sessionID, body)
      status.value = { type: "busy" }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      sending.value = false
    }
  }

  async function abort(client: ServerClient, sessionID: string) {
    await client.interrupt(sessionID)
    status.value = { type: "idle" }
  }

  async function replyPermission(
    client: ServerClient,
    requestID: string,
    sessionID: string,
    decision: "once" | "always" | "reject",
  ) {
    await client.replyPermission(sessionID, requestID, decision)
    permissions.value = permissions.value.filter((item) => item.id !== requestID)
  }

  async function replyForm(client: ServerClient, sessionID: string, formID: string, answer: FormAnswer) {
    await client.replyForm(sessionID, formID, answer)
    forms.value = forms.value.filter((item) => item.id !== formID)
  }

  async function cancelForm(client: ServerClient, sessionID: string, formID: string) {
    await client.cancelForm(sessionID, formID)
    forms.value = forms.value.filter((item) => item.id !== formID)
  }

  function applyEvent(event: V2Event, client: ServerClient) {
    // `session.message.content.updated` carries an authoritative content
    // snapshot, but is not part of the generated event union yet, so it is
    // matched defensively before the switch.
    const type = event.type as string
    if (type === "session.message.content.updated") {
      const data = (event as unknown as {
        data: { sessionID: string; messageID: string; content: AssistantContent[] }
      }).data
      if (data.sessionID !== currentSessionID.value) return
      const message = findMessage(data.messageID)
      if (message) {
        message.content = [...data.content]
        live.delete(data.messageID)
        seed([message])
      } else {
        scheduleReconcile(client, data.sessionID)
      }
      return
    }

    switch (event.type) {
      /* ------------------------------ lifecycle ------------------------------ */
      case "session.execution.started": {
        if (event.data.sessionID !== currentSessionID.value) return
        status.value = { type: "busy" }
        return
      }
      case "session.status": {
        if (event.data.sessionID !== currentSessionID.value) return
        status.value = event.data.status
        return
      }
      case "session.idle": {
        if (event.data.sessionID !== currentSessionID.value) return
        status.value = { type: "idle" }
        void reconcileNow()
        return
      }
      case "session.execution.succeeded":
      case "session.execution.interrupted": {
        if (event.data.sessionID !== currentSessionID.value) return
        status.value = { type: "idle" }
        void reconcileNow()
        return
      }
      case "session.execution.failed": {
        if (event.data.sessionID !== currentSessionID.value) return
        status.value = { type: "idle" }
        error.value = event.data.error?.message ?? "The agent run failed."
        void reconcileNow()
        return
      }

      /* ------------------------------- messages ------------------------------ */
      case "session.inbox.enqueued":
      case "session.inbox.delivered":
      case "session.synthetic":
      case "session.skill.activated":
      case "session.shell.started":
      case "session.shell.ended": {
        if (event.data.sessionID !== currentSessionID.value) return
        scheduleReconcile(client, event.data.sessionID)
        return
      }

      /* -------------------------------- steps -------------------------------- */
      case "session.step.started": {
        if (event.data.sessionID !== currentSessionID.value) return
        const message = ensureAssistant(event.data.assistantMessageID, event.data.agent, event.data.model)
        message.time = { ...message.time, created: event.data.started ?? Date.now() }
        status.value = { type: "busy" }
        return
      }
      case "session.step.streamed": {
        if (event.data.sessionID !== currentSessionID.value) return
        const message = findMessage(event.data.assistantMessageID)
        if (message) message.time = { ...message.time, streamed: Date.now() }
        return
      }
      case "session.step.ended": {
        if (event.data.sessionID !== currentSessionID.value) return
        const message = findMessage(event.data.assistantMessageID)
        if (message) {
          message.time = { ...message.time, completed: Date.now() }
          message.finish = event.data.finish
          message.cost = event.data.cost
          message.tokens = event.data.tokens
        }
        void reconcileNow()
        return
      }
      case "session.step.failed": {
        if (event.data.sessionID !== currentSessionID.value) return
        const message = findMessage(event.data.assistantMessageID)
        if (message) {
          message.time = { ...message.time, completed: Date.now() }
          message.error = event.data.error
          if (event.data.tokens) message.tokens = event.data.tokens
        }
        error.value = event.data.error?.message ?? "The model returned an error."
        void reconcileNow()
        return
      }

      /* -------------------------------- content ------------------------------ */
      case "session.text.delta": {
        if (event.data.sessionID !== currentSessionID.value) return
        appendText(event.data.assistantMessageID, event.data.ordinal, event.data.delta)
        return
      }
      case "session.text.ended": {
        if (event.data.sessionID !== currentSessionID.value) return
        setText(event.data.assistantMessageID, event.data.ordinal, event.data.text)
        return
      }
      case "session.reasoning.delta": {
        if (event.data.sessionID !== currentSessionID.value) return
        appendReasoning(event.data.assistantMessageID, event.data.ordinal, event.data.delta)
        return
      }
      case "session.reasoning.ended": {
        if (event.data.sessionID !== currentSessionID.value) return
        setReasoning(event.data.assistantMessageID, event.data.ordinal, event.data.text)
        return
      }

      /* --------------------------------- tools ------------------------------- */
      case "session.tool.input.started": {
        if (event.data.sessionID !== currentSessionID.value) return
        toolBlock(event.data.assistantMessageID, event.data.id, event.data.name)
        return
      }
      case "session.tool.input.delta": {
        if (event.data.sessionID !== currentSessionID.value) return
        const entry = toolBlock(event.data.assistantMessageID, event.data.id)
        if (entry && entry.block.state.status === "streaming") {
          entry.block.state.input += event.data.delta
        }
        return
      }
      case "session.tool.input.ended": {
        if (event.data.sessionID !== currentSessionID.value) return
        toolBlock(event.data.assistantMessageID, event.data.id)
        return
      }
      case "session.tool.called": {
        if (event.data.sessionID !== currentSessionID.value) return
        const entry = toolBlock(event.data.assistantMessageID, event.data.id)
        if (entry) {
          entry.block.executed = event.data.executed
          entry.block.state = { status: "running", input: event.data.input, metadata: {} }
        }
        return
      }
      case "session.tool.progress": {
        if (event.data.sessionID !== currentSessionID.value) return
        const entry = toolBlock(event.data.assistantMessageID, event.data.id)
        if (entry && entry.block.state.status === "running") {
          entry.block.state = { ...entry.block.state, metadata: event.data.metadata }
        }
        return
      }
      case "session.tool.success": {
        if (event.data.sessionID !== currentSessionID.value) return
        const entry = toolBlock(event.data.assistantMessageID, event.data.id)
        if (entry) {
          entry.block.executed = event.data.executed
          entry.block.state = {
            status: "completed",
            input: toolInput(entry.block.state),
            content: event.data.content,
            metadata: event.data.metadata ?? {},
          }
        }
        return
      }
      case "session.tool.failed": {
        if (event.data.sessionID !== currentSessionID.value) return
        const entry = toolBlock(event.data.assistantMessageID, event.data.id)
        if (entry) {
          entry.block.executed = event.data.executed
          entry.block.state = {
            status: "error",
            input: toolInput(entry.block.state),
            error: event.data.error,
            content: event.data.content,
            metadata: event.data.metadata ?? {},
          }
        }
        return
      }

      /* ---------------------------- permissions/forms ------------------------ */
      case "permission.asked": {
        const request = event.data
        if (!permissions.value.some((item) => item.id === request.id)) {
          permissions.value = [...permissions.value, request]
        }
        return
      }
      case "permission.replied": {
        permissions.value = permissions.value.filter((item) => item.id !== event.data.requestID)
        return
      }
      case "form.created": {
        const form = event.data.form
        if (!forms.value.some((item) => item.id === form.id)) forms.value = [...forms.value, form]
        return
      }
      case "form.replied":
      case "form.cancelled": {
        forms.value = forms.value.filter((item) => item.id !== event.data.id)
        return
      }
      default:
        return
    }
  }

  function reset() {
    if (reconcileTimer) {
      clearTimeout(reconcileTimer)
      reconcileTimer = null
    }
    reconcileContext = null
    currentSessionID.value = null
    messages.value = []
    live.clear()
    status.value = { type: "idle" }
    error.value = null
    permissions.value = []
    forms.value = []
  }

  return {
    messages,
    status,
    isBusy,
    loading,
    sending,
    error,
    pendingPermissions,
    pendingForms,
    currentSessionID,
    scrollToBottomRequest,
    open,
    send,
    abort,
    replyPermission,
    replyForm,
    cancelForm,
    applyEvent,
    reset,
  }
}
