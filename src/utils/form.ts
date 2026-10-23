/**
 * Helpers shared by the question card and the composer.
 *
 * A question reaches the UI as a v2 form. The card owns everything that is
 * *chosen* — options, checkboxes, numbers — while a free-form answer can be
 * typed into the usual composer, so a question never grows a second input area.
 */

import type { FormField, FormInfo, FormValue } from "@/api/types"

/** The answer a field has so far, looked up by key. */
export type FieldValues = (key: string) => unknown

/** A form's answers as the server reads them. */
export type FormAnswerBody = Record<string, FormValue>

/** The value a field starts from when nothing has been picked or typed. */
export function fieldDefault(field: FormField): FormValue {
  if ("default" in field && field.default !== undefined) return field.default as FormValue
  if (field.type === "multiselect") return []
  if (field.type === "boolean") return false
  return ""
}

/** Whether a conditional field applies, given the values of the fields it depends on. */
export function isVisible(field: FormField, values: FieldValues): boolean {
  if ("hidden" in field && field.hidden) return false
  if (!("when" in field) || !field.when?.length) return true
  return field.when.every((condition) => {
    const current = values(condition.key)
    const matches = Array.isArray(current) ? current.includes(String(condition.value)) : current === condition.value
    return condition.op === "eq" ? matches : !matches
  })
}

/** The fields a person actually sees; a hidden one only contributes its default. */
export function visibleFields(form: FormInfo, values: FieldValues): FormField[] {
  return form.fields.filter((field) => isVisible(field, values))
}

/** The values a form starts from, before anything is picked or typed. */
export function defaultValues(form: FormInfo): FormAnswerBody {
  const values: FormAnswerBody = {}
  for (const field of form.fields) values[field.key] = fieldDefault(field)
  return values
}

/** A lookup over the form's defaults, for asking what would be visible. */
export function defaultLookup(form: FormInfo): FieldValues {
  const values = defaultValues(form)
  return (key) => values[key]
}

/** Coerce a raw value to the shape the field's type expects. */
export function normalizeValue(field: FormField, value: unknown): FormValue {
  if (field.type === "multiselect") return Array.isArray(value) ? (value as string[]) : []
  if (field.type === "boolean") return value === true || value === "true"
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "string") return value as FormValue
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  return typeof value === "string" ? value : String(value ?? "")
}

/**
 * Whether a line typed in the composer can answer this field.
 *
 * A field that offers options only takes one of them — unless it also invites a
 * custom answer — while a checkbox, a multiple choice or an external link has
 * nothing a typed line could fill.
 */
export function acceptsText(field: FormField): boolean {
  if (field.type === "boolean" || field.type === "multiselect" || field.type === "external") return false
  if (field.type === "string" && field.options?.length) return field.custom === true
  return true
}

/** Whether the card itself has anything to click, so it needs its Submit button. */
export function hasCardControls(form: FormInfo): boolean {
  return visibleFields(form, defaultLookup(form)).some(
    (field) => Boolean("options" in field && field.options?.length) || field.type === "boolean",
  )
}

/**
 * The answer a line typed in the composer gives a pending question.
 *
 * The text lands on the first field that can take it — a question usually has a
 * single free-form one — and every other field keeps its default, because the
 * server reads the answer as a whole. Returns null when no visible field could
 * take typed text, so the caller can fall back to sending a normal message
 * rather than answering a question nobody asked.
 */
export function answerFromText(form: FormInfo, text: string): FormAnswerBody | null {
  const body = text.trim()
  if (!body) return null
  const values = defaultValues(form)
  const fields = visibleFields(form, (key) => values[key])
  const target = fields.find(acceptsText)
  if (!target) return null
  const answer: FormAnswerBody = {}
  for (const field of fields) {
    answer[field.key] = normalizeValue(field, field === target ? body : values[field.key])
  }
  return answer
}
