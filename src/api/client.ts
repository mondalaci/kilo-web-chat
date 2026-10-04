import type {
  Agent,
  Command,
  GlobalHealth,
  MessageWithParts,
  ModelRef,
  ModelState,
  PathInfo,
  Project,
  ProviderList,
  ServerConfig,
  SessionInfo,
  ServerEvent,
  PermissionRequest,
  QuestionRequest,
  Todo,
} from "./types"

export interface Credentials {
  username: string
  password: string
}

export class ServerError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string,
  ) {
    super(`HTTP ${status} ${statusText}${body ? `: ${body.slice(0, 300)}` : ""}`)
    this.name = "ServerError"
  }

  get unauthorized() {
    return this.status === 401
  }
}

export interface RequestOptions {
  method?: string
  /** Instance directory (project) to scope the request to. */
  directory?: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

/**
 * Thin client over the opencode v1 / kilo HTTP API.
 *
 * Auth is HTTP Basic, matching the server's optional `KILO_SERVER_PASSWORD`.
 * All instance-scoped endpoints accept a `directory` query parameter that
 * selects the project instance on the server.
 */
export class ServerClient {
  readonly origin: string
  private authHeader?: string

  constructor(origin: string, credentials?: Credentials) {
    this.origin = origin.replace(/\/+$/, "")
    if (credentials?.password) {
      const token = btoa(`${credentials.username || "kilo"}:${credentials.password}`)
      this.authHeader = `Basic ${token}`
    }
  }

  private url(path: string, opts?: RequestOptions): string {
    const url = new URL(this.origin + path)
    if (opts?.directory) url.searchParams.set("directory", opts.directory)
    for (const [key, value] of Object.entries(opts?.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private headers(extra?: Record<string, string>, body?: unknown): HeadersInit {
    const headers: Record<string, string> = { Accept: "application/json", ...extra }
    if (this.authHeader) headers.Authorization = this.authHeader
    if (body !== undefined) headers["Content-Type"] = "application/json"
    return headers
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await fetch(this.url(path, opts), {
      method: opts.method ?? "GET",
      headers: this.headers(opts.headers, opts.body),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ServerError(res.status, res.statusText, body)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }

  /* ------------------------------ health/config ----------------------------- */

  health(signal?: AbortSignal) {
    return this.request<GlobalHealth>("/global/health", { signal })
  }

  path(opts: RequestOptions = {}) {
    return this.request<PathInfo>("/path", opts)
  }

  projects(opts: RequestOptions = {}) {
    return this.request<Project[]>("/project", opts)
  }

  config(opts: RequestOptions = {}) {
    return this.request<ServerConfig>("/config", opts)
  }

  agents(opts: RequestOptions = {}) {
    return this.request<Agent[]>("/agent", opts)
  }

  providers(opts: RequestOptions = {}) {
    return this.request<ProviderList>("/provider", opts)
  }

  modelState(opts: RequestOptions = {}) {
    return this.request<ModelState>("/config/model-state", opts)
  }

  commands(opts: RequestOptions = {}) {
    return this.request<Command[]>("/command", opts)
  }

  /* -------------------------------- sessions -------------------------------- */

  listSessions(opts: RequestOptions = {}) {
    return this.request<SessionInfo[]>("/session", { ...opts, query: { roots: "true", ...opts.query } })
  }

  createSession(body: { title?: string; agent?: string; model?: ModelRef; parentID?: string }, opts: RequestOptions = {}) {
    // The create endpoint names the model field `id`, while prompt endpoints use
    // `modelID`. Normalize here so callers can keep passing a ModelRef.
    const payload = {
      ...body,
      model: body.model
        ? { id: body.model.modelID, providerID: body.model.providerID, variant: body.model.variant }
        : undefined,
    }
    return this.request<SessionInfo>("/session", { ...opts, method: "POST", body: payload })
  }

  getSession(sessionID: string, opts: RequestOptions = {}) {
    return this.request<SessionInfo>(`/session/${sessionID}`, opts)
  }

  updateSession(sessionID: string, body: { title?: string }, opts: RequestOptions = {}) {
    return this.request<SessionInfo>(`/session/${sessionID}`, { ...opts, method: "PATCH", body })
  }

  deleteSession(sessionID: string, opts: RequestOptions = {}) {
    return this.request<boolean>(`/session/${sessionID}`, { ...opts, method: "DELETE" })
  }

  messages(sessionID: string, opts: RequestOptions = {}) {
    return this.request<MessageWithParts[]>(`/session/${sessionID}/message`, opts)
  }

  todos(sessionID: string, opts: RequestOptions = {}) {
    return this.request<Todo[]>(`/session/${sessionID}/todo`, opts)
  }

  prompt(
    sessionID: string,
    body: {
      parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>
      model?: ModelRef
      agent?: string
      variant?: string
      messageID?: string
      system?: string
    },
    opts: RequestOptions = {},
  ) {
    return this.request<void>(`/session/${sessionID}/prompt_async`, { ...opts, method: "POST", body })
  }

  command(
    sessionID: string,
    body: { command: string; arguments: string; agent?: string; model?: string; variant?: string },
    opts: RequestOptions = {},
  ) {
    return this.request<unknown>(`/session/${sessionID}/command`, { ...opts, method: "POST", body })
  }

  abort(sessionID: string, opts: RequestOptions = {}) {
    return this.request<boolean>(`/session/${sessionID}/abort`, { ...opts, method: "POST" })
  }

  /* ------------------------- permissions and questions ---------------------- */

  listPermissions(opts: RequestOptions = {}) {
    return this.request<PermissionRequest[]>("/permission", opts)
  }

  replyPermission(requestID: string, reply: "once" | "always" | "reject", opts: RequestOptions = {}) {
    return this.request<boolean>(`/permission/${requestID}/reply`, { ...opts, method: "POST", body: { reply } })
  }

  listQuestions(opts: RequestOptions = {}) {
    return this.request<QuestionRequest[]>("/question", opts)
  }

  replyQuestion(requestID: string, answers: string[][], opts: RequestOptions = {}) {
    return this.request<boolean>(`/question/${requestID}/reply`, { ...opts, method: "POST", body: { answers } })
  }

  rejectQuestion(requestID: string, opts: RequestOptions = {}) {
    return this.request<boolean>(`/question/${requestID}/reject`, { ...opts, method: "POST" })
  }

  /* ---------------------------------- SSE ----------------------------------- */

  /**
   * Subscribe to the instance event stream.
   *
   * Uses `fetch` rather than `EventSource` so that Basic auth headers can be
   * sent. Resolves when the stream ends (abort or error).
   */
  async subscribe(
    onEvent: (event: ServerEvent) => void,
    opts: { directory?: string; signal?: AbortSignal; onOpen?: () => void } = {},
  ): Promise<void> {
    const res = await fetch(this.url("/event", { directory: opts.directory }), {
      headers: this.headers({ Accept: "text/event-stream" }),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "")
      throw new ServerError(res.status, res.statusText, body)
    }
    opts.onOpen?.()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index: number
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (!data) continue
        try {
          onEvent(JSON.parse(data) as ServerEvent)
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}