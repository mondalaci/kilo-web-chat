import { ClientError, OpenCode, isUnauthorizedError } from "@opencode/client"
import type {
  Agent,
  ConfigEntry,
  FormAnswer,
  FormInfo,
  LocationPublicInfo,
  Model,
  ModelRef,
  PermissionRequest,
  Project,
  SessionInfo,
  SessionMessageID,
  SessionMessageInfo,
  SessionStatus,
  SkillInfo,
  Command,
  Provider,
  V2Event,
} from "./types"

export interface Credentials {
  username: string
  password: string
}

/** Username the opencode server expects alongside its service password. */
export const DEFAULT_USERNAME = "opencode"

/** A normalized transport/HTTP failure the UI can present. */
export class ServerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = "ServerError"
  }

  get unauthorized() {
    return this.status === 401
  }
}

/**
 * Declared API failures (the generated client throws tagged errors such as
 * `UnauthorizedError`) and transport failures are folded into one error type so
 * callers do not need to know which layer failed.
 */
export function toServerError(error: unknown): ServerError {
  if (error instanceof ServerError) return error
  const tag = (error as { _tag?: string } | null)?._tag
  if (isUnauthorizedError(error) || tag === "UnauthorizedError") {
    return new ServerError(401, "Authentication required")
  }
  if (tag === "SessionNotFoundError") return new ServerError(404, "Session not found")
  if (tag === "LocationNotFoundError") return new ServerError(404, "Location not found")
  if (error instanceof ClientError) return new ServerError(0, error.message)
  if (error instanceof Error) return new ServerError(0, error.message)
  return new ServerError(0, String(error))
}

export interface SessionPage {
  data: SessionInfo[]
  /** Opaque cursor for the next page, or null at the end of the list. */
  next: string | null
}

export interface MessagePage {
  data: SessionMessageInfo[]
  /** Opaque cursor for the page before this one, or null at the start. */
  previous: string | null
}

export interface PromptFileInput {
  /** A `data:` URL (`data:<mime>;base64,<payload>`) or a file/http URI. */
  uri: string
  name?: string
}

export interface ConfigValues {
  /** Merged `model` string (`provider/model`) from the config documents. */
  model?: string
  defaultAgent?: string
  username?: string
}

/**
 * Thin wrapper over the generated `@opencode/client` client.
 *
 * Its job is to (a) attach the server's HTTP Basic credentials, (b) scope
 * calls to the selected project directory and (c) normalize errors, so the
 * stores never deal with transport details.
 */
export class ServerClient {
  readonly origin: string
  private readonly sdk: ReturnType<typeof OpenCode.make>

  constructor(origin: string, credentials?: Credentials) {
    this.origin = origin.replace(/\/+$/, "")
    const headers = credentials?.password
      ? { authorization: `Basic ${btoa(`${credentials.username || DEFAULT_USERNAME}:${credentials.password}`)}` }
      : undefined
    this.sdk = OpenCode.make({ baseUrl: this.origin, headers })
  }

  /** The raw generated client, for call sites this wrapper does not cover. */
  get api() {
    return this.sdk
  }

  private static location(directory?: string | null) {
    return directory ? { location: { directory } } : undefined
  }

  private static wrap<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((error: unknown) => {
      throw toServerError(error)
    })
  }

  /* --------------------------------- server -------------------------------- */

  async info() {
    return ServerClient.wrap(this.sdk.server.info())
  }

  async locationInfo(directory?: string | null) {
    return ServerClient.wrap<LocationPublicInfo>(
      this.sdk.location.get(ServerClient.location(directory)),
    )
  }

  /* ------------------------------ configuration ---------------------------- */

  async agents(directory?: string | null): Promise<Agent[]> {
    const result = await ServerClient.wrap(this.sdk.agent.list(ServerClient.location(directory)))
    return result.data
  }

  async models(directory?: string | null): Promise<Model[]> {
    const result = await ServerClient.wrap(
      this.sdk.model.list(ServerClient.location(directory)),
    )
    return result.data
  }

  /** The model the server would pick when a session does not name one. */
  async defaultModel(directory?: string | null): Promise<Model | null> {
    const result = await ServerClient.wrap(
      this.sdk.model.default(ServerClient.location(directory)),
    )
    return result.data
  }

  async providers(directory?: string | null): Promise<Provider[]> {
    const result = await ServerClient.wrap(this.sdk.provider.list(ServerClient.location(directory)))
    return result.data
  }

  async configs(directory?: string | null): Promise<ConfigEntry[]> {
    return ServerClient.wrap(this.sdk.config.get(ServerClient.location(directory)))
  }

  /**
   * Merge the config documents into the handful of values the app needs.
   * Later entries win, matching the server's own merge order.
   */
  async configValues(directory?: string | null): Promise<ConfigValues> {
    const entries = await this.configs(directory)
    const values: ConfigValues = {}
    for (const entry of entries) {
      if (entry.type !== "document") continue
      const info = entry.info ?? {}
      const model = info.model
      if (typeof model === "string") values.model = model
      else if (model && typeof model === "object" && "providerID" in model && "model" in model) {
        values.model = `${model.providerID}/${model.model}`
      }
      if (typeof info.default_agent === "string") values.defaultAgent = info.default_agent
      if (typeof info.username === "string") values.username = info.username
    }
    return values
  }

  /** Active provider credentials, keyed by integration id. */
  async connectedIntegrations(): Promise<Set<string>> {
    const connected = new Set<string>()
    try {
      for (const credential of await this.sdk.credential.list()) {
        if (credential.active) connected.add(credential.integrationID)
      }
    } catch {
      /* credentials are optional; the picker then marks nothing as connected */
    }
    return connected
  }

  /** The stored credential value for an integration, when one is active. */
  async credentialKey(integrationID: string): Promise<string | null> {
    try {
      const credentials = await this.sdk.credential.list()
      const credential = credentials.find((item) => item.active && item.integrationID === integrationID)
      const value = credential?.value
      if (value && value.type === "key") return value.key
    } catch {
      /* fall through */
    }
    return null
  }

  async projects(): Promise<Project[]> {
    return ServerClient.wrap(this.sdk.project.list())
  }

  async commands(directory?: string | null): Promise<Command[]> {
    const result = await ServerClient.wrap(this.sdk.command.list(ServerClient.location(directory)))
    return result.data
  }

  async skills(directory?: string | null): Promise<SkillInfo[]> {
    const result = await ServerClient.wrap(this.sdk.skill.list(ServerClient.location(directory)))
    return result.data
  }

  /* -------------------------------- sessions -------------------------------- */

  async listSessions(
    directory?: string | null,
    opts: { limit?: number; search?: string; cursor?: string } = {},
  ): Promise<SessionPage> {
    const page = await ServerClient.wrap(
      this.sdk.session.list({
        directory: directory ?? undefined,
        limit: opts.limit ?? 50,
        search: opts.search,
        cursor: opts.cursor,
        parentID: "null",
      }),
    )
    return { data: page.data, next: page.cursor.next ?? null }
  }

  async createSession(
    body: { title?: string; agent?: string; model?: ModelRef },
    directory?: string | null,
  ): Promise<SessionInfo> {
    return ServerClient.wrap(
      this.sdk.session.create({
        title: body.title,
        agent: body.agent,
        model: body.model ? { id: body.model.id, providerID: body.model.providerID, variant: body.model.variant } : undefined,
        location: directory ? { directory } : undefined,
      }),
    )
  }

  async getSession(sessionID: string): Promise<SessionInfo> {
    return ServerClient.wrap(this.sdk.session.get({ sessionID }))
  }

  async updateSession(sessionID: string, body: { title?: string }): Promise<void> {
    return ServerClient.wrap(this.sdk.session.update({ sessionID, title: body.title }))
  }

  async removeSession(sessionID: string): Promise<void> {
    return ServerClient.wrap(this.sdk.session.remove({ sessionID }))
  }

  /** Sessions currently executing on the server, keyed by session id. */
  async activeSessions(): Promise<Record<string, SessionStatus>> {
    const active = await ServerClient.wrap(this.sdk.session.active()).catch(() => ({}))
    const statuses: Record<string, SessionStatus> = {}
    for (const id of Object.keys(active)) statuses[id] = { type: "busy" }
    return statuses
  }

  /* -------------------------------- messages -------------------------------- */

  /** Newest page of messages first, matching the server's default order. */
  async listMessages(sessionID: string, opts: { limit?: number; cursor?: string } = {}): Promise<MessagePage> {
    const page = await ServerClient.wrap(
      this.sdk.message.list({ sessionID, limit: opts.limit ?? 200, cursor: opts.cursor }),
    )
    return { data: page.data, previous: page.cursor.previous ?? null }
  }

  /**
   * Every message in a session, oldest first. The endpoint pages from the
   * newest message backwards, so walk the `previous` cursors and reverse.
   */
  async allMessages(sessionID: string, pageSize = 200): Promise<SessionMessageInfo[]> {
    const newestFirst: SessionMessageInfo[] = []
    let page = await this.listMessages(sessionID, { limit: pageSize })
    newestFirst.push(...page.data)
    let guard = 0
    while (page.previous && page.data.length > 0 && guard++ < 200) {
      page = await this.listMessages(sessionID, { limit: pageSize, cursor: page.previous })
      newestFirst.push(...page.data)
    }
    return newestFirst.reverse()
  }

  async prompt(
    sessionID: string,
    body: { text: string; files?: PromptFileInput[] },
  ): Promise<SessionMessageID> {
    const result = await ServerClient.wrap(
      this.sdk.session.prompt({
        sessionID,
        text: body.text,
        files: body.files?.map((file) => ({ uri: file.uri, name: file.name })),
      }),
    )
    return result.id
  }

  async interrupt(sessionID: string): Promise<void> {
    await ServerClient.wrap(this.sdk.session.interrupt({ sessionID }))
  }

  async switchAgent(sessionID: string, agent: string): Promise<void> {
    await ServerClient.wrap(this.sdk.session.switchAgent({ sessionID, agent }))
  }

  async switchModel(sessionID: string, model: ModelRef): Promise<void> {
    await ServerClient.wrap(
      this.sdk.session.switchModel({
        sessionID,
        model: { id: model.id, providerID: model.providerID, variant: model.variant },
      }),
    )
  }

  /* --------------------------- permission and forms -------------------------- */

  async pendingPermissions(directory?: string | null): Promise<PermissionRequest[]> {
    const result = await ServerClient.wrap(
      this.sdk.permission.request.list(ServerClient.location(directory)),
    )
    return result.data
  }

  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: "once" | "always" | "reject",
  ): Promise<void> {
    await ServerClient.wrap(this.sdk.permission.reply({ sessionID, requestID, decision }))
  }

  /** Pending forms (the agent's `question` tool) for the whole location. */
  async pendingForms(directory?: string | null): Promise<FormInfo[]> {
    const result = await ServerClient.wrap(this.sdk.form.list(ServerClient.location(directory)))
    return result.data
  }

  async sessionForms(sessionID: string): Promise<FormInfo[]> {
    return ServerClient.wrap(this.sdk.session.form.list({ sessionID })).catch(() => [] as FormInfo[])
  }

  async replyForm(sessionID: string, formID: string, answer: FormAnswer): Promise<void> {
    await ServerClient.wrap(this.sdk.session.form.reply({ sessionID, formID, answer }))
  }

  async cancelForm(sessionID: string, formID: string): Promise<void> {
    await ServerClient.wrap(this.sdk.session.form.cancel({ sessionID, formID }))
  }

  /* ---------------------------------- events --------------------------------- */

  /**
   * Subscribe to the instance event stream.
   *
   * The generated client already parses SSE frames and yields decoded events;
   * this only translates transport failures. Resolves when the stream ends.
   */
  async subscribe(
    onEvent: (event: V2Event) => void,
    opts: { signal?: AbortSignal; onOpen?: () => void } = {},
  ): Promise<void> {
    let opened = false
    try {
      for await (const event of this.sdk.event.subscribe({ signal: opts.signal })) {
        if (!opened) {
          opened = true
          opts.onOpen?.()
        }
        onEvent(event)
      }
    } catch (error) {
      if (opts.signal?.aborted) return
      throw toServerError(error)
    }
  }
}
