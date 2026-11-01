import type {
  FormAnswer,
  FormField,
  FormValue,
} from "@/lib/opencode"

/**
 * Pure form-answer semantics mirroring the server's `validateAnswer` /
 * `validateField` (packages/core/src/form.ts). The server is authoritative:
 * `when` rules are ANDed and inactive fields are neither required nor
 * answerable; external fields are acknowledged with `true`; `always`-style
 * unknown keys are rejected. Keeping the mirror here lets the UI show the exact
 * required/invalid state before POSTing, instead of round-tripping a 400.
 */

export type InputField = Extract<
  FormField,
  { type: "string" | "number" | "integer" | "boolean" | "multiselect" }
>

export function isInputField(field: FormField): field is InputField {
  return field.type !== "external"
}

/** The initial answer seeded from each field's declared `default`. */
export function defaultAnswer(fields: FormField[]): FormAnswer {
  const answer: FormAnswer = {}

  for (const field of fields) {
    if (field.type === "external") {
      continue
    }

    if (field.default !== undefined) {
      answer[field.key] = field.default
    }
  }

  return answer
}

/**
 * A field is active when it has no `when`, or every `when` condition matches.
 * An unanswered referenced field makes the condition false (server `matches`),
 * so hiding a field cascades to every condition that references it.
 */
export function isFieldActive(field: FormField, answer: FormAnswer): boolean {
  if (field.type === "external") {
    return true
  }

  if (!field.when) {
    return true
  }

  return field.when.every((when) => {
    const value = answer[when.key]
    const hit = matches(value, when.value)
    return when.op === "eq" ? hit : !hit
  })
}

function matches(value: FormValue | undefined, expected: FormValue): boolean {
  if (value === undefined) {
    return false
  }

  return Array.isArray(value)
    ? value.some((item) => item === expected)
    : value === expected
}

/** Fields the UI should render: not hidden and currently active. */
export function visibleFields(
  fields: FormField[],
  answer: FormAnswer
): FormField[] {
  return fields.filter((field) => {
    if (field.type === "external") {
      return true
    }

    return field.hidden !== true && isFieldActive(field, answer)
  })
}

function isEmpty(value: FormValue | undefined): boolean {
  return (
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
}

/**
 * The answer to POST: active fields' values only, plus `true` for every
 * external acknowledgement. Inactive or empty non-required fields are omitted
 * so an earlier answer that later becomes inactive can never be sent.
 */
export function buildReplyAnswer(
  fields: FormField[],
  answer: FormAnswer
): FormAnswer {
  const reply: FormAnswer = {}

  for (const field of fields) {
    if (field.type === "external") {
      reply[field.key] = true
      continue
    }

    if (!isFieldActive(field, answer)) {
      continue
    }

    const value = answer[field.key]

    if (isEmpty(value)) {
      continue
    }

    reply[field.key] = value
  }

  return reply
}

/** First validation error, or null when the answer is submittable. */
export function validateForm(
  fields: FormField[],
  answer: FormAnswer
): string | null {
  const known = new Set(fields.map((field) => field.key))

  for (const key of Object.keys(answer)) {
    if (!known.has(key)) {
      return `Unknown field: ${key}`
    }
  }

  for (const field of fields) {
    if (field.type === "external") {
      if (answer[field.key] !== true) {
        return `Acknowledge the external step: ${field.title ?? field.key}`
      }

      continue
    }

    const value = answer[field.key]
    const active = isFieldActive(field, answer)

    if (isEmpty(value)) {
      if (field.required && active) {
        return `“${field.title ?? field.key}” is required.`
      }

      continue
    }

    if (!active) {
      continue
    }

    const invalid = validateFieldValue(field, value)

    if (invalid) {
      return invalid
    }
  }

  return null
}

/** Per-field errors for inline `aria-invalid`/`aria-describedby` association. */
export function fieldErrorMap(
  fields: FormField[],
  answer: FormAnswer
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    if (field.type === "external") {
      if (answer[field.key] !== true) {
        errors[field.key] = "Acknowledge this step to continue."
      }

      continue
    }

    const value = answer[field.key]

    if (!isFieldActive(field, answer)) {
      continue
    }

    if (isEmpty(value)) {
      if (field.required) {
        errors[field.key] = "Required."
      }

      continue
    }

    const invalid = validateFieldValue(field, value)

    if (invalid) {
      errors[field.key] = invalid
    }
  }

  return errors
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isDateTime(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime())
}

function label(field: FormField): string {
  return field.title ?? field.key
}

export function validateFieldValue(
  field: InputField,
  value: FormValue
): string | null {
  if (field.type === "string") {
    if (typeof value !== "string") {
      return `Expected text for “${label(field)}”.`
    }

    if (field.required && value.length === 0) {
      return `“${label(field)}” is required.`
    }

    if (field.minLength !== undefined && value.length < field.minLength) {
      return `“${label(field)}” must be at least ${field.minLength} characters.`
    }

    if (field.maxLength !== undefined && value.length > field.maxLength) {
      return `“${label(field)}” must be at most ${field.maxLength} characters.`
    }

    if (field.pattern !== undefined) {
      try {
        if (!new RegExp(field.pattern).test(value)) {
          return `“${label(field)}” does not match the required pattern.`
        }
      } catch {
        return `“${label(field)}” has an invalid pattern.`
      }
    }

    if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return `Enter a valid email for “${label(field)}”.`
    }

    if (field.format === "uri" && !URL.canParse(value)) {
      return `Enter a valid URL for “${label(field)}”.`
    }

    if (field.format === "date" && !isDate(value)) {
      return `Enter a valid date for “${label(field)}”.`
    }

    if (field.format === "date-time" && !isDateTime(value)) {
      return `Enter a valid date-time for “${label(field)}”.`
    }

    if (
      field.options &&
      !field.custom &&
      !field.options.some((option) => option.value === value)
    ) {
      return `Choose an option for “${label(field)}”.`
    }

    return null
  }

  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `Enter a number for “${label(field)}”.`
    }

    if (field.type === "integer" && !Number.isInteger(value)) {
      return `Enter a whole number for “${label(field)}”.`
    }

    if (
      field.minimum !== undefined &&
      typeof field.minimum === "number" &&
      value < field.minimum
    ) {
      return `“${label(field)}” must be at least ${field.minimum}.`
    }

    if (
      field.maximum !== undefined &&
      typeof field.maximum === "number" &&
      value > field.maximum
    ) {
      return `“${label(field)}” must be at most ${field.maximum}.`
    }

    return null
  }

  if (field.type === "boolean") {
    if (typeof value !== "boolean") {
      return `Expected a yes/no answer for “${label(field)}”.`
    }

    return null
  }

  // multiselect
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === "string")
  ) {
    return `Expected selections for “${label(field)}”.`
  }

  if (field.required && value.length === 0) {
    return `Select at least one option for “${label(field)}”.`
  }

  if (field.minItems !== undefined && value.length < field.minItems) {
    return `Select at least ${field.minItems} for “${label(field)}”.`
  }

  if (field.maxItems !== undefined && value.length > field.maxItems) {
    return `Select at most ${field.maxItems} for “${label(field)}”.`
  }

  if (
    !field.custom &&
    value.some((item) => !field.options.some((option) => option.value === item))
  ) {
    return `Invalid option for “${label(field)}”.`
  }

  return null
}
