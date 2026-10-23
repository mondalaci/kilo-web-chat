/**
 * Types for the opencode v2 HTTP API.
 *
 * Instead of hand-maintaining a mirror of the server's schema, the app
 * re-exports the contract generated into `@opencode/client`, which is released
 * in lockstep with the server (see the dependency version in package.json).
 * A few aliases keep the app's call sites short.
 */

export type {
  AbsolutePath,
  ConfigEntry,
  FormAnswer,
  FormBooleanField,
  FormDetail,
  FormExternalField,
  FormField,
  FormInfo,
  FormIntegerField,
  FormMultiselectField,
  FormNumberField,
  FormOption,
  FormStringField,
  FormValue,
  LocationPublicInfo,
  LocationPublicRef,
  ModelCapabilities,
  ModelCost,
  ModelRef,
  ModelVariant,
  OpenCodeEvent,
  PermissionReply,
  PermissionRequest,
  PermissionRule,
  PermissionRuleset,
  Project,
  PromptFileAttachment,
  PromptFileSource,
  SessionActive,
  SessionID,
  SessionInfo,
  SessionMessageAgentSelected,
  SessionMessageAssistant,
  SessionMessageCompaction,
  SessionMessageID,
  SessionMessageIdle,
  SessionMessageInfo,
  SessionMessageLocationSwitched,
  SessionMessageModelSelected,
  SessionMessageShell,
  SessionMessageSkill,
  SessionMessageSynthetic,
  SessionMessageSystem,
  SessionMessageToolStateCompleted,
  SessionMessageToolStateError,
  SessionMessageToolStateRunning,
  SessionMessageToolStateStreaming,
  SessionMessageUser,
  SessionStatus,
  SkillInfo,
  TokenUsageInfo,
  ToolContent,
  ToolFileContent,
  ToolFileContent1,
  ToolTextContent,
  V2Event,
} from "@opencode/client"

import type { AgentInfo, ModelInfo, SessionMessageAssistant } from "@opencode/client"

// The generated contract prefixes every entity with its aggregate name; the app
// uses the short form.
export type Agent = AgentInfo
export type Model = ModelInfo
export type Command = import("@opencode/client").CommandInfo
export type Provider = import("@opencode/client").ProviderInfo

/** Everything an assistant message can contain, in order. */
export type AssistantContent = SessionMessageAssistant["content"][number]
export type AssistantText = Extract<AssistantContent, { type: "text" }>
export type AssistantReasoning = Extract<AssistantContent, { type: "reasoning" }>
export type AssistantTool = Extract<AssistantContent, { type: "tool" }>
export type ToolState = AssistantTool["state"]

/** A model's variants are objects; the app only needs their ids. */
export function variantIDs(model: Model | undefined | null): string[] {
  return (model?.variants ?? []).map((variant) => variant.id)
}

/**
 * The first (base) price tier of a model, or undefined for unpriced models.
 * v2 models carry a cost *array* (context-length tiers); the picker shows the
 * base tier only.
 */
export function baseCost(model: Model | undefined | null) {
  return model?.cost?.[0]
}

/** A model is "free" when its base tier charges nothing for input and output. */
export function isFreeModel(model: Model | undefined | null): boolean {
  const cost = baseCost(model)
  return !!cost && !cost.input && !cost.output
}

/** Whether a model accepts image (or other non-text) input. */
export function acceptsImages(model: Model | undefined | null): boolean {
  return !!model?.capabilities?.input?.some((kind) => kind !== "text")
}
