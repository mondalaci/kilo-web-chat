import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import { normalizeOrigin } from "@/api/discovery"
import type { Agent, Command, Model, ModelRef, ModelState, PathInfo, Project, Provider, ServerConfig } from "@/api/types"

const PREFS_KEY = "kilo-web-chat.prefs"

interface Preferences {
  [origin: string]: { agent?: string; model?: ModelRef; directory?: string }
}

function loadPrefs(): Preferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Preferences
    // Canonicalize origin keys so preferences survive the localhost/127.0.0.1
    // normalization.
    const merged: Preferences = {}
    for (const [key, value] of Object.entries(parsed)) {
      const origin = normalizeOrigin(key) ?? key
      merged[origin] = { ...merged[origin], ...value }
    }
    return merged
  } catch {
    return {}
  }
}

const prefs = ref<Preferences>(loadPrefs())

function persistPrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value))
  } catch {
    /* ignore */
  }
}

export interface ModelChoice {
  providerID: string
  providerName: string
  connected: boolean
  model: Model
}

export interface ModelGroup {
  providerID: string
  providerName: string
  connected: boolean
  models: Model[]
}

const origin = ref<string | null>(null)
const pathInfo = ref<PathInfo | null>(null)
const config = ref<ServerConfig | null>(null)
const agents = ref<Agent[]>([])
const providers = ref<Provider[]>([])
const connectedProviderIDs = ref<string[]>([])
const commands = ref<Command[]>([])
const projects = ref<Project[]>([])
const modelState = ref<ModelState | null>(null)
const selectedDirectory = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const selectedAgent = ref<string>("code")
const selectedModel = ref<ModelRef | null>(null)

/** Providers sorted so connected ones come first, then alphabetically. */
const providerGroups = computed<ModelGroup[]>(() => {
  const connected = new Set(connectedProviderIDs.value)
  return providers.value
    .filter((provider) => Object.keys(provider.models ?? {}).length > 0)
    .map((provider) => ({
      providerID: provider.id,
      providerName: provider.name || provider.id,
      connected: connected.has(provider.id),
      models: Object.values(provider.models).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1
      return a.providerName.localeCompare(b.providerName)
    })
})

const modes = computed<Agent[]>(() => agents.value.filter((agent) => agent.mode === "primary" && !agent.hidden))

const selectedAgentInfo = computed<Agent | undefined>(() =>
  modes.value.find((agent) => agent.name === selectedAgent.value),
)

const selectedModelInfo = computed<Model | undefined>(() => {
  const ref_ = selectedModel.value
  if (!ref_) return undefined
  const provider = providers.value.find((item) => item.id === ref_.providerID)
  return provider?.models?.[ref_.modelID]
})

function parseModelString(value: string | undefined): ModelRef | null {
  if (!value) return null
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

export function useServer() {
  function applyDefaults() {
    const cfg = config.value
    const defaults = prefs.value[origin.value ?? ""] ?? {}
    selectedAgent.value = defaults.agent ?? cfg?.default_agent ?? modes.value[0]?.name ?? "code"
    selectedModel.value = resolveDefaultModel()
  }

  /**
   * Resolve the same default the server would use when a prompt omits a model:
   * saved pref → agent model → model-state for the agent → config.model → the
   * first recent model whose provider is loaded.
   */
  function resolveDefaultModel(): ModelRef | null {
    const defaults = prefs.value[origin.value ?? ""] ?? {}
    if (defaults.model) return defaults.model
    const agentModel = selectedAgentInfo.value?.model
    if (agentModel) return agentModel
    const agentState = modelState.value?.model?.[selectedAgent.value]
    if (agentState) return agentState
    const cfgModel = parseModelString(config.value?.model)
    if (cfgModel) return cfgModel
    for (const ref of modelState.value?.recent ?? []) {
      const provider = providers.value.find((item) => item.id === ref.providerID)
      if (provider?.models?.[ref.modelID]) return ref
    }
    return null
  }

  async function load(client: ServerClient, instanceOrigin: string, directory?: string) {
    const changedOrigin = origin.value !== instanceOrigin
    origin.value = instanceOrigin
    loading.value = true
    error.value = null

    // Apply saved agent/model synchronously so the UI never flashes the default
    // ("code") before the persisted choice loads.
    const saved = prefs.value[instanceOrigin] ?? {}
    if (saved.agent) selectedAgent.value = saved.agent
    if (saved.model) selectedModel.value = saved.model

    try {
      // Prefer the requested directory (last used project), falling back to the
      // server's default project if it is gone.
      let path = directory ? await client.path({ directory }).catch(() => null) : null
      let dir = directory && path ? directory : undefined
      if (!dir || !path) {
        path = await client.path().catch(() => null)
        dir = path?.worktree ?? path?.directory ?? undefined
      }
      pathInfo.value = path
      selectedDirectory.value = dir ?? null

      const [cfg, agentList, providerList, commandList, projectList, state] = await Promise.all([
        client.config({ directory: dir }).catch(() => null),
        client.agents({ directory: dir }).catch(() => [] as Agent[]),
        client.providers({ directory: dir }).catch(() => null),
        client.commands({ directory: dir }).catch(() => [] as Command[]),
        client.projects().catch(() => [] as Project[]),
        client.modelState({ directory: dir }).catch(() => null),
      ])
      config.value = cfg
      agents.value = agentList
      providers.value = providerList?.all ?? []
      connectedProviderIDs.value = providerList?.connected ?? []
      commands.value = commandList
      projects.value = projectList
      modelState.value = state
      // Don't clobber the current agent/model when only switching project.
      if (changedOrigin || !selectedModel.value) applyDefaults()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function savedDirectory(instanceOrigin: string): string | undefined {
    return prefs.value[instanceOrigin]?.directory
  }

  /**
   * Synchronously apply saved agent/model for an origin. Call before connecting
   * so the shell never flashes the "code" default while the server loads.
   */
  function applySavedPrefs(instanceOrigin: string) {
    const saved = prefs.value[instanceOrigin] ?? {}
    if (saved.agent) selectedAgent.value = saved.agent
    if (saved.model) selectedModel.value = saved.model
  }

  function setDirectory(dir: string) {
    selectedDirectory.value = dir
    const key = origin.value
    if (key) {
      prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], directory: dir } }
      persistPrefs()
    }
  }

  function reset() {
    origin.value = null
    pathInfo.value = null
    config.value = null
    agents.value = []
    providers.value = []
    connectedProviderIDs.value = []
    commands.value = []
    projects.value = []
    modelState.value = null
    selectedDirectory.value = null
    selectedModel.value = null
  }

  function setAgent(name: string) {
    selectedAgent.value = name
    const key = origin.value ?? ""
    prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], agent: name } }
    persistPrefs()
  }

  function setModel(model: ModelRef) {
    selectedModel.value = model
    const key = origin.value ?? ""
    prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], model } }
    persistPrefs()
  }

  /** The directory that scopes all instance requests (the selected project). */
  const directory = computed(
    () => selectedDirectory.value ?? pathInfo.value?.worktree ?? pathInfo.value?.directory ?? undefined,
  )

  return {
    pathInfo,
    config,
    agents,
    providers,
    commands,
    projects,
    selectedDirectory,
    loading,
    error,
    modes,
    providerGroups,
    selectedAgent,
    selectedAgentInfo,
    selectedModel,
    selectedModelInfo,
    directory,
    load,
    setDirectory,
    savedDirectory,
    applySavedPrefs,
    reset,
    setAgent,
    setModel,
  }
}