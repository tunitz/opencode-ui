import { useState } from "react"
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldError,
  FieldGroup,
} from "@/components/ui/field"
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

function Title({
  field,
  required,
}: {
  field: FormField
  required?: boolean
}) {
  return (
    <span className="text-[13px] break-words font-medium">
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

  return (
    <p className="text-xs break-words text-muted-foreground">
      {field.description}
    </p>
  )
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
  const errorID = `${id}-error`
  const describedBy = error ? errorID : undefined

  if (field.type === "external") {
    const externalUrl = safeExternalUrl(field.url)
    return (
      <Field className="flex flex-col gap-1.5">
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
        <FieldError id={errorID}>{error}</FieldError>
      </Field>
    )
  }

  if (field.type === "boolean") {
    return (
      <Field className="flex flex-col gap-1.5">
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
        <FieldError id={errorID}>{error}</FieldError>
      </Field>
    )
  }

  if (field.type === "number" || field.type === "integer") {
    const min = typeof field.minimum === "number" ? field.minimum : undefined
    const max = typeof field.maximum === "number" ? field.maximum : undefined

    return (
      <Field className="flex flex-col gap-1.5">
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
        <FieldError id={errorID}>{error}</FieldError>
      </Field>
    )
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : []

    return (
      <Field className="flex flex-col gap-1.5">
        <span className="block">
          <Title field={field} required={field.required} />
        </span>
        <Description field={field} />
        <div
          className="flex flex-col gap-0.5"
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
        <FieldError id={errorID}>{error}</FieldError>
      </Field>
    )
  }

  // string
  const stringValue = typeof value === "string" ? value : ""

  if (field.options && !field.custom) {
    return (
      <Field className="flex flex-col gap-1.5">
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
        <FieldError id={errorID}>{error}</FieldError>
      </Field>
    )
  }

  const nativeType = formatInputType(field.format)

  if (field.options && field.custom) {
    return (
      <Field className="flex flex-col gap-1.5">
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
        <FieldError id={errorID}>{error}</FieldError>
      </Field>
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
    <Field className="flex flex-col gap-1.5">
      <label htmlFor={id} className="block">
        <Title field={field} required={field.required} />
      </label>
      <Description field={field} />
      {control}
      <FieldError id={errorID}>{error}</FieldError>
    </Field>
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
      className="flex flex-col gap-3 rounded-xl border border-border/70 p-4"
    >
      <h3 className="text-sm break-words font-semibold tracking-tight">
        {form.title}
      </h3>
      <FieldGroup className="gap-3">
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
      </FieldGroup>
      <FieldError>{submitError}</FieldError>
      <FieldError>{cancelError}</FieldError>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void cancel()}
          disabled={pending}
          className="h-11 px-4"
        >
          Cancel
        </Button>
        <Button
          type="submit"
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
