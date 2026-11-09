import { useState } from "react"
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { PickerSelect } from "@/components/ui/picker-select"
import { Textarea } from "@/components/ui/textarea"
import { safeExternalUrl } from "@/lib/provider-auth"
import {
  buildReplyAnswer,
  defaultAnswer,
  fieldErrorMap,
  validateForm,
  visibleFields,
} from "@/lib/form-state"
import type {
  FormAnswer,
  FormField,
  FormInfo,
  FormValue,
} from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"

function fieldId(formID: string, key: string): string {
  return `form-${formID}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`
}

function formatInputType(format: string | undefined): string | undefined {
  switch (format) {
    case "email":
      return "email"
    case "uri":
      return "url"
    case "date":
      return "date"
    case "date-time":
      return "datetime-local"
    default:
      return undefined
  }
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) {
    return null
  }

  return (
    <p id={`${id}-error`} role="alert" className="text-xs break-words text-destructive">
      {error}
    </p>
  )
}

function Title({
  field,
  required,
}: {
  field: FormField
  required?: boolean
}) {
  return (
    <span className="text-[13px] font-medium">
      {field.title ?? field.key}
      {required ? (
        <span aria-hidden="true" className="text-destructive">
          {" "}
          *
        </span>
      ) : null}
    </span>
  )
}

function Description({ field }: { field: FormField }) {
  if (!field.description) {
    return null
  }

  return <p className="text-xs text-muted-foreground">{field.description}</p>
}

export function FieldRenderer({
  formID,
  field,
  value,
  error,
  onChange,
}: {
  formID: string
  field: FormField
  value: FormValue | undefined
  error?: string
  onChange: (value: FormValue | undefined) => void
}) {
  const id = fieldId(formID, field.key)
  const describedBy = error ? `${id}-error` : undefined

  if (field.type === "external") {
    const externalUrl = safeExternalUrl(field.url)
    return (
      <div className="space-y-1.5">
        <Title field={field} />
        <Description field={field} />
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground underline underline-offset-4"
          >
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            Open external step
          </a>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            External step URL is not safe to open here. Follow the native instructions.
          </p>
        )}
        <label
          htmlFor={id}
          className="flex min-h-11 items-center gap-2 rounded-lg px-1 py-2"
        >
          <Checkbox
            id={id}
            checked={value === true}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
            onCheckedChange={(checked) =>
              onChange(checked === true ? true : undefined)
            }
          />
          <span className="text-[13px]">I completed this step</span>
        </label>
        <FieldError id={id} error={error} />
      </div>
    )
  }

  if (field.type === "boolean") {
    return (
      <div className="space-y-1.5">
        <label
          htmlFor={id}
          className="flex min-h-11 items-center gap-2 rounded-lg px-1 py-2"
        >
          <Checkbox
            id={id}
            checked={value === true}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Title field={field} />
        </label>
        <Description field={field} />
        <FieldError id={id} error={error} />
      </div>
    )
  }

  if (field.type === "number" || field.type === "integer") {
    const min = typeof field.minimum === "number" ? field.minimum : undefined
    const max = typeof field.maximum === "number" ? field.maximum : undefined

    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block">
          <Title field={field} required={field.required} />
        </label>
        <Description field={field} />
        <Input
          id={id}
          type="number"
          inputMode={field.type === "integer" ? "numeric" : "decimal"}
          step={field.type === "integer" ? "1" : "any"}
          min={min}
          max={max}
          value={typeof value === "number" ? String(value) : ""}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            const raw = event.target.value
            onChange(raw === "" ? undefined : Number(raw))
          }}
          className="h-11"
        />
        <FieldError id={id} error={error} />
      </div>
    )
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : []

    return (
      <div className="space-y-1.5">
        <span className="block">
          <Title field={field} required={field.required} />
        </span>
        <Description field={field} />
        <div
          className="space-y-0.5"
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
        >
          {field.options.map((option) => {
            const checked = selected.includes(option.value)

            return (
              <label
                key={option.value}
                className="flex min-h-11 items-start gap-2 rounded-lg px-1 py-2"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => {
                    const base = next
                      ? [...selected, option.value]
                      : selected.filter((item) => item !== option.value)
                    onChange(base)
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]">{option.label}</span>
                  {option.description ? (
                    <span className="block text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>
        <FieldError id={id} error={error} />
      </div>
    )
  }

  // string
  const stringValue = typeof value === "string" ? value : ""

  if (field.options && !field.custom) {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block">
          <Title field={field} required={field.required} />
        </label>
        <Description field={field} />
        <PickerSelect
          id={id}
          label={field.title ?? field.key}
          value={stringValue || null}
          options={field.options.map((option) => ({
            value: option.value,
            label: option.label,
            detail: option.description,
          }))}
          placeholder="Choose…"
          onValueChange={(next) => onChange(next)}
          triggerProps={{
            "aria-describedby": describedBy,
            "aria-invalid": Boolean(error),
          }}
        />
        <FieldError id={id} error={error} />
      </div>
    )
  }

  const nativeType = formatInputType(field.format)

  if (field.options && field.custom) {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block">
          <Title field={field} required={field.required} />
        </label>
        <Description field={field} />
        <Input
          id={id}
          list={`${id}-options`}
          value={stringValue}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="h-11"
        />
        <datalist id={`${id}-options`}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </datalist>
        <FieldError id={id} error={error} />
      </div>
    )
  }

  const control = nativeType ? (
    <Input
      id={id}
      type={nativeType}
      value={stringValue}
      aria-describedby={describedBy}
      aria-invalid={Boolean(error)}
      placeholder={field.placeholder}
      minLength={field.minLength}
      maxLength={field.maxLength}
      onChange={(event) => onChange(event.target.value)}
      className="h-11"
    />
  ) : (
    <Textarea
      id={id}
      value={stringValue}
      aria-describedby={describedBy}
      aria-invalid={Boolean(error)}
      placeholder={field.placeholder}
      minLength={field.minLength}
      maxLength={field.maxLength}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-20"
    />
  )

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block">
        <Title field={field} required={field.required} />
      </label>
      <Description field={field} />
      {control}
      <FieldError id={id} error={error} />
    </div>
  )
}

export function FormView({
  nav,
  form,
}: {
  nav: OpenCodeController
  form: FormInfo
}) {
  const [answer, setAnswer] = useState<FormAnswer>(() =>
    defaultAnswer(form.fields)
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const visible = visibleFields(form.fields, answer)
  const errors = fieldErrorMap(form.fields, answer)
  const pending = Boolean(nav.formBusy[form.id])

  function setValue(key: string, value: FormValue | undefined) {
    setAnswer((current) => {
      const next = { ...current }

      if (value === undefined) {
        delete next[key]
      } else {
        next[key] = value
      }

      return next
    })
  }

  async function submit() {
    setSubmitError(null)

    const invalid = validateForm(form.fields, answer)

    if (invalid) {
      setSubmitError(invalid)
      return
    }

    const failure = await nav.replyForm(
      form.id,
      buildReplyAnswer(form.fields, answer)
    )

    if (failure) {
      setSubmitError(failure)
    }
  }

  async function cancel() {
    setCancelError(null)
    const failure = await nav.cancelForm(form.id)

    if (failure) {
      setCancelError(failure)
    }
  }

  return (
    <section
      aria-label={form.title}
      className="space-y-3 rounded-xl border border-border/70 p-4"
    >
      <h3 className="text-sm font-semibold tracking-tight">{form.title}</h3>
      <div className="space-y-3">
        {visible.map((field) => (
          <FieldRenderer
            key={field.key}
            formID={form.id}
            field={field}
            value={answer[field.key]}
            error={errors[field.key]}
            onChange={(value) => setValue(field.key, value)}
          />
        ))}
      </div>
      {submitError ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {submitError}
        </p>
      ) : null}
      {cancelError ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {cancelError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => void cancel()}
          disabled={pending}
          className="h-11 px-4"
        >
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={pending}
          aria-busy={pending}
          className="h-11 px-4"
        >
          {pending ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-4 animate-spin"
            />
          ) : null}
          Submit
        </Button>
      </div>
    </section>
  )
}
