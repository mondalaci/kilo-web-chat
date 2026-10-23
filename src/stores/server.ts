import { computed, ref } from "vue"
import type { ServerClient } from "@/api/client"
import { normalizeOrigin } from "@/api/discovery"
import type { Agent, Model, ModelRef, Project, Provider, SkillInfo } from "@/api/types"
import { baseCost, isFreeModel, variantIDs } from "@/api/types"

const PREFS_KEY = "opencode-web-chat.prefs"

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

export interface ModelGroup {
  providerID: string
  providerName: string
  connected: boolean
  models: Model[]
}

const origin = ref<string | null>(null)
const directory = ref<string | null>(null)
const agents = ref<Agent[]>([])
const models = ref<Model[]>([])
const providers = ref<Provider[]>([])
const connectedProviderIDs = ref<string[]>([])
const skills = ref<SkillInfo[]>([])
const projects = ref<Project[]>([])
const configValues = ref<{ model?: string; defaultAgent?: string; username?: string } | null>(null)
const serverDefaultModel = ref<ModelRef | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const selectedAgent = ref<string>("build")
const selectedModel = ref<ModelRef | null>(null)

/** Providers sorted so connected ones come first, then alphabetically. */
const providerGroups = computed<ModelGroup[]>(() => {
  const connected = new Set(connectedProviderIDs.value)
  const groups = new Map<string, ModelGroup>()
  for (const model of models.value) {
    const provider = providers.value.find((item) => item.id === model.providerID)
    const group = groups.get(model.providerID) ?? {
      providerID: model.providerID,
      providerName: provider?.name || model.providerID,
      connected: connected.has(model.providerID),
      models: [],
    }
    group.models.push(model)
    groups.set(model.providerID, group)
  }
  return [...groups.values()]
    .map((group) => ({ ...group, models: [...group.models].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1
      return a.providerName.localeCompare(b.providerName)
    })
})

/** Primary, non-hidden agents — the ones a chat can be started with. */
const modes = computed<Agent[]>(() => agents.value.filter((agent) => agent.mode === "primary" && !agent.hidden))

const selectedAgentInfo = computed<Agent | undefined>(() =>
  modes.value.find((agent) => agent.id === selectedAgent.value),
)

const selectedModelInfo = computed<Model | undefined>(() => {
  const ref_ = selectedModel.value
  if (!ref_) return undefined
  return models.value.find((item) => item.providerID === ref_.providerID && item.id === ref_.id)
})

const selectedModelVariants = computed<string[]>(() => variantIDs(selectedModelInfo.value))
const selectedVariant = computed<string | undefined>(() => selectedModel.value?.variant)

function parseModelString(value: string | undefined): ModelRef | null {
  if (!value) return null
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return null
  return { id: modelID, providerID }
}

/** Normalize a loose model reference into the shape the API expects. */
export function toModelRef(model: Model | ModelRef): ModelRef {
  const modelID = "modelID" in model ? model.modelID : model.id
  const variant = "variant" in model ? model.variant : undefined
  return { id: modelID, providerID: model.providerID, variant }
}

export function useServer() {
  function resolved(ref_: ModelRef | null | undefined): ModelRef | null {
    if (!ref_?.id) return null
    return { id: ref_.id, providerID: ref_.providerID, variant: ref_.variant }
  }

  /**
   * Drop a variant the selected model does not offer.
   *
   * The model list is the only authority on which variants exist, so this runs
   * once it is loaded rather than where a selection is made.
   */
  function withVariant(ref_: ModelRef | null | undefined): ModelRef | null {
    if (!ref_?.id) return null
    if (!ref_.variant) return ref_
    const info = models.value.find((item) => item.providerID === ref_.providerID && item.id === ref_.id)
    if (info?.variants.some((variant) => variant.id === ref_.variant)) return ref_
    return { id: ref_.id, providerID: ref_.providerID }
  }

  /**
   * Fallback selection when neither the session nor the saved preferences name
   * an agent/model: config default agent → config model → server default model.
   */
  function applyDefaults() {
    const saved = prefs.value[origin.value ?? ""] ?? {}
    selectedAgent.value =
      saved.agent ??
      configValues.value?.defaultAgent ??
      modes.value[0]?.id ??
      agents.value[0]?.id ??
      "build"

    const candidates: Array<ModelRef | null> = [
      resolved(saved.model),
      resolved(parseModelString(configValues.value?.model)),
      resolved(serverDefaultModel.value),
      resolved(selectedAgentInfo.value?.model),
    ]
    selectedModel.value = candidates.find((candidate) => candidate != null) ?? null
  }

  async function load(client: ServerClient, instanceOrigin: string, projectDirectory?: string) {
    const changedOrigin = origin.value !== instanceOrigin
    origin.value = instanceOrigin
    loading.value = true
    error.value = null

    // Apply saved agent/model synchronously so the UI never flashes the default
    // while the request is in flight.
    const saved = prefs.value[instanceOrigin] ?? {}
    if (saved.agent) selectedAgent.value = saved.agent
    if (saved.model) selectedModel.value = resolved(saved.model)

    try {
      const dir = projectDirectory ?? saved.directory
      directory.value = dir ?? null

      const [agentList, modelList, providerList, projectList, config, defaultModel, credentialIntegrations, skillList] =
        await Promise.all([
          client.agents(dir).catch(() => [] as Agent[]),
          client.models(dir).catch(() => [] as Model[]),
          client.providers(dir).catch(() => [] as Provider[]),
          client.projects().catch(() => [] as Project[]),
          client.configValues(dir).catch(() => null),
          client.defaultModel(dir).catch(() => null),
          client.connectedIntegrations().catch(() => new Set<string>()),
          client.skills(dir).catch(() => [] as SkillInfo[]),
        ])

      agents.value = agentList
      models.value = modelList
      providers.value = providerList
      projects.value = projectList
      configValues.value = config
      serverDefaultModel.value = defaultModel ? { id: defaultModel.modelID, providerID: defaultModel.providerID } : null
      const withKeys = providerList
        .filter((provider) => typeof provider.settings?.apiKey === "string" && provider.settings.apiKey.length > 0)
        .map((provider) => provider.id)
      connectedProviderIDs.value = [...new Set([...credentialIntegrations, ...withKeys])]
      skills.value = skillList
      // Don't clobber the current agent/model when only switching project.
      if (changedOrigin || !selectedModel.value) applyDefaults()
      // A remembered agent can name one the server no longer has.
      ensureAgent()
      // A remembered variant can outlive the model it was chosen for — saved
      // preferences, or a model whose variants changed — and the server refuses a
      // switch that names one the model does not offer.
      selectedModel.value = withVariant(selectedModel.value)
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
   * so the shell never flashes a default while the server loads.
   */
  function applySavedPrefs(instanceOrigin: string) {
    const saved = prefs.value[instanceOrigin] ?? {}
    if (saved.agent) selectedAgent.value = saved.agent
    if (saved.model) selectedModel.value = resolved(saved.model)
  }

  function setDirectory(dir: string) {
    directory.value = dir
    const key = origin.value
    if (key) {
      prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], directory: dir } }
      persistPrefs()
    }
  }

  function reset() {
    origin.value = null
    directory.value = null
    agents.value = []
    models.value = []
    providers.value = []
    connectedProviderIDs.value = []
    skills.value = []
    projects.value = []
    configValues.value = null
    serverDefaultModel.value = null
    selectedModel.value = null
  }

  /**
   * Keep the selection on an agent the server still has.
   *
   * A remembered agent can outlive the agent itself: a saved preference, or a
   * session created while a now-deleted agent was selected. Naming one to the
   * server fails the next prompt with `Agent not found`, so fall back to the first
   * primary agent the server offers.
   */
  function ensureAgent() {
    if (agents.value.some((item) => item.id === selectedAgent.value)) return
    selectedAgent.value = modes.value[0]?.id ?? agents.value[0]?.id ?? "build"
  }

  /** Adopt a session's own agent/model as the current selection. */
  function applySession(session: { agent?: string; model?: ModelRef }) {
    if (session.agent) selectedAgent.value = session.agent
    ensureAgent()
    const model = resolved(session.model)
    if (model) selectedModel.value = model
  }

  /** Persist the agent selection without touching the server. */
  function setAgentLocal(name: string) {
    selectedAgent.value = name
    const key = origin.value ?? ""
    prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], agent: name } }
    persistPrefs()
  }

  /** Persist the model selection without touching the server. */
  function setModelLocal(model: Model | ModelRef, variant?: string) {
    const next = resolved({ ...toModelRef(model), variant: variant ?? (model as ModelRef).variant })
    if (!next) return
    selectedModel.value = next
    const key = origin.value ?? ""
    prefs.value = { ...prefs.value, [key]: { ...prefs.value[key], model: next } }
    persistPrefs()
  }

  return {
    directory,
    agents,
    models,
    providers,
    connectedProviderIDs,
    skills,
    projects,
    configValues,
    loading,
    error,
    modes,
    providerGroups,
    selectedAgent,
    selectedAgentInfo,
    selectedModel,
    selectedModelInfo,
    selectedModelVariants,
    selectedVariant,
    load,
    setDirectory,
    savedDirectory,
    applySavedPrefs,
    applySession,
    applyDefaults,
    reset,
    setAgentLocal,
    setModelLocal,
  }
}

/** Price label helpers shared by the model picker. */
export function modelCostLabel(model: Model): string {
  if (isFreeModel(model)) return "free"
  const cost = baseCost(model)
  if (!cost || (!cost.input && !cost.output)) return ""
  return `$${price(cost.input)}/$${price(cost.output)}`
}

/** Compact USD-per-1M-token price: `$3/$15`. */
export function price(value: number): string {
  if (!value) return "0"
  if (value >= 1) return value.toFixed(2).replace(/\.00$/, "")
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}
