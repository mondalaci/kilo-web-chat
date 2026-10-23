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
  SessionActive,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionStatus,
  SessionStructuredError,
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

/** Replace one assistant message, keeping the array's identity semantics. */
function updateAssistant(messageID: string, update: (message: SessionMessageAssistant) => SessionMessageAssistant) {
  const index = messages.value.findIndex((item) => item.id === messageID)
  if (index === -1) return
  const message = messages.value[index]
  if (message.type !== "assistant") return
  const next = messages.value.slice()
  next[index] = update(message)
  messages.value = next
}

/**
 * Record a failure where it happened.
 *
 * A step or turn error belongs on the message it interrupted: it scrolls with
 * the conversation and is not mistaken for a failure of whatever the reader
 * does next. The banner is only for errors that have no message to attach to.
 */
function attachError(err: SessionStructuredError | undefined, messageID?: string) {
  if (!err) return
  const target = messageID ?? [...messages.value].reverse().find((item) => item.type === "assistant")?.id
  if (!target) {
    error.value = err.message || "The turn failed."
    return
  }
  updateAssistant(target, (message) => ({ ...message, error: err }))
}

/**
 * Whether the server has a turn running for this session.
 *
 * `GET /api/session/active` answers it directly and is preferred. The fallback
 * reads the session record, whose `time.idle` is sticky: it describes the last
 * turn that ended, not the one that may be running now, so it only means
 * something next to the message it followed.
 */
function isRunning(
  active: Record<string, SessionActive> | null,
  session: SessionInfo | null,
  sessionID: string,
  newest: SessionMessageInfo | undefined,
): boolean {
  if (active) return sessionID in active
  const idle = session?.time?.idle
  if (idle === undefined) return false
  return idle < (newest?.time?.created ?? 0)
}

/**
 * Stop anything a finished turn left looking in flight.
 *
 * A tool block only leaves `streaming`/`running` when its own success or failure
 * event lands, and an assistant message is only completed by `session.step.ended`.
 * A turn that is interrupted — or whose events were lost in a gap in the stream —
 * delivers neither, so the card spins and the message streams for ever although
 * the server has long moved on. Only the last assistant message can be in flight.
 */
function settleUnfinishedTools(outcome: "succeeded" | "failed" | "interrupted") {
  let at = messages.value.length - 1
  while (at >= 0 && messages.value[at].type !== "assistant") at--
  if (at < 0) return
  const message = messages.value[at] as SessionMessageAssistant

  const unfinished: SessionStructuredError = {
    type: outcome,
    message:
      outcome === "interrupted"
        ? "The turn was interrupted before this tool reported a result."
        : "The turn ended before this tool reported a result.",
  }
  const content = message.content.map((block): AssistantContent => {
    if (block.type !== "tool") return block
    if (block.state.status !== "streaming" && block.state.status !== "running") return block
    const input = block.state.status === "running" ? block.state.input : {}
    return { ...block, state: { status: "error", input, error: unfinished } }
  })
  const settled: SessionMessageAssistant = {
    ...message,
    content,
    time: { ...message.time, completed: message.time.completed ?? Date.now() },
    // A retry note only describes a turn that is still waiting to try again.
    retry: undefined,
  }
  const next = messages.value.slice()
  next[at] = settled
  messages.value = next
  // The live index still points at the replaced blocks, so rebuild it.
  live.delete(message.id)
  seed([settled])
}

/** End the turn: nothing is running any more, so nothing may still look it. */
function completeTurn(outcome: "succeeded" | "failed" | "interrupted") {
  status.value = { type: "idle" }
  settleUnfinishedTools(outcome)
}

export function useChat() {
  const isBusy = computed(() => status.value.type === "busy" || status.value.type === "retry")

  const pendingPermissions = computed(() =>
    permissions.value.filter((request) => request.sessionID === currentSessionID.value),
  )
  const pendingForms = computed(() => forms.value.filter((form) => form.sessionID === currentSessionID.value))
  /** The turn is parked on a question or a permission prompt, not streaming. */
  const awaitingUser = computed(() => pendingPermissions.value.length > 0 || pendingForms.value.length > 0)

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
      const [list, perms, pendingForms, session, active] = await Promise.all([
        client.allMessages(sessionID),
        client.pendingPermissions(directory).catch(() => [] as PermissionRequest[]),
        client.pendingForms(directory).catch(() => [] as FormInfo[]),
        client.getSession(sessionID).catch(() => null),
        client.activeSessions(),
      ])
      // Ignore a response for a session the user already navigated away from.
      if (currentSessionID.value !== sessionID) return
      setMessages(list)
      permissions.value = perms
      forms.value = pendingForms
      // Only the server knows what is running, and a message that never reports a
      // result must not keep the view spinning: a turn that ended without its
      // events arriving leaves exactly that shape behind.
      if (isRunning(active, session, sessionID, list[list.length - 1])) {
        status.value = { type: "busy" }
      } else {
        completeTurn(session?.outcome ?? "succeeded")
      }
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

  /**
   * Stop the turn.
   *
   * A run parked on a question or a permission prompt is idle as far as the
   * server is concerned, so interrupting would cancel nothing: the asks
   * themselves are what hold it. Withdraw them first — the tool call then
   * returns and the agent resumes — and interrupt only what still runs after.
   */
  async function abort(client: ServerClient, sessionID: string) {
    const asks = forms.value.filter((form) => form.sessionID === sessionID)
    const requests = permissions.value.filter((request) => request.sessionID === sessionID)
    await Promise.allSettled([
      ...asks.map((form) => client.cancelForm(sessionID, form.id)),
      ...requests.map((request) => client.replyPermission(sessionID, request.id, "reject")),
    ])
    // Clear locally too, in case the matching events arrive late or not at all.
    forms.value = forms.value.filter((form) => form.sessionID !== sessionID)
    permissions.value = permissions.value.filter((request) => request.sessionID !== sessionID)
    try {
      await client.interrupt(sessionID)
    } catch {
      /* nothing running to interrupt; the withdrawn asks are the stop */
    }
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
      case "session.retry.scheduled": {
        if (event.data.sessionID !== currentSessionID.value) return
        // The turn is still live — it is waiting to try again — so it stays busy
        // while saying so, instead of looking like ordinary work.
        const { attempt, error: retryError, assistantMessageID } = event.data
        const at = event.data.at ?? Date.now()
        status.value = { type: "retry", attempt, next: at, message: retryError?.message ?? "Retrying" }
        updateAssistant(assistantMessageID, (message) => ({
          ...message,
          retry: { attempt, at, error: retryError ?? { type: "retry", message: "Retrying" } },
        }))
        return
      }
      case "session.idle":
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        if (event.data.sessionID !== currentSessionID.value) return
        // A failed execution carries the reason, and nothing else reports it.
        if (event.type === "session.execution.failed") attachError(event.data.error)
        // "interrupted" is the one that used to leave the view spinning:
        // interrupting produces `session.execution.interrupted` — a terminal
        // event of its own — so the turn has to end here as well, or the last
        // message keeps its streaming caret after the step is already over.
        const outcome =
          event.type === "session.execution.failed"
            ? "failed"
            : event.type === "session.execution.interrupted"
              ? "interrupted"
              : "succeeded"
        completeTurn(outcome)
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
        // The failure belongs to the step it happened in, so it is shown on that
        // message. Mirroring it into the banner as well printed the same text
        // twice, one line above the other, every time a step was interrupted.
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
    awaitingUser,
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
