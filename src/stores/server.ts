import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import { normalizeOrigin } from "@/api/discovery"
import type { Agent, Command, Model, ModelRef, PathInfo, Project, Provider, ServerConfig } from "@/api/types"

const PREFS_KEY = "kilo-web-chat.prefs"

interface Preferences {
  [origin: string]: { agent?: string; model?: ModelRef }
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
    selectedModel.value =
      defaults.model ??
      parseModelString(cfg?.model) ??
      selectedAgentInfo.value?.model ??
      null
  }

  async function load(client: ServerClient, instanceOrigin: string, directory?: string) {
    const changedOrigin = origin.value !== instanceOrigin
    origin.value = instanceOrigin
    loading.value = true
    error.value = null
    try {
      const path = await client.path(directory ? { directory } : {}).catch(() => null)
      pathInfo.value = path
      const dir = directory ?? path?.worktree ?? path?.directory ?? undefined
      selectedDirectory.value = dir ?? null

      const [cfg, agentList, providerList, commandList, projectList] = await Promise.all([
        client.config({ directory: dir }).catch(() => null),
        client.agents({ directory: dir }).catch(() => [] as Agent[]),
        client.providers({ directory: dir }).catch(() => null),
        client.commands({ directory: dir }).catch(() => [] as Command[]),
        client.projects().catch(() => [] as Project[]),
      ])
      config.value = cfg
      agents.value = agentList
      providers.value = providerList?.all ?? []
      connectedProviderIDs.value = providerList?.connected ?? []
      commands.value = commandList
      projects.value = projectList
      // Don't clobber the current agent/model when only switching project.
      if (changedOrigin || !selectedModel.value) applyDefaults()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function setDirectory(dir: string) {
    selectedDirectory.value = dir
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
    reset,
    setAgent,
    setModel,
  }
}