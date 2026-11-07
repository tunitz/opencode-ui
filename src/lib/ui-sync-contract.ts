import { z } from "zod"

// Only explicitly named UI metadata is accepted. Never put prompts, drafts,
// credentials, transcripts, or other session content in these fields.
const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:@/-]+$/)
const label = z.string().min(1).max(80).refine((value) => Array.from(value).every((character) => {
  const code = character.codePointAt(0)!
  return code >= 32 && !(code >= 127 && code <= 159) && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069)
}))
const model = z.strictObject({ providerID: id, modelID: id })
const defaults = z.strictObject({ agentID: id.nullable(), model: model.nullable(), thinkingLevel: id.nullable() })

export const uiSyncSnapshotSchema = z.strictObject({
  version: z.literal(1),
  backendVersion: id,
  preferences: z.strictObject({
    theme: z.enum(["light", "dark", "system"]),
    global: defaults,
    startup: z.union([z.strictObject({ mode: z.literal("last") }), z.strictObject({ mode: z.literal("pinned"), projectID: id })]),
  }),
  presets: z.array(z.strictObject({ name: label, agent: id, model: z.strictObject({ providerID: id, id, variant: id.optional() }) })).max(50),
  pins: z.array(id).max(500),
  labels: z.array(z.strictObject({ id, label: label.max(60) })).max(500),
}).refine((snapshot) => new Set([...snapshot.pins, ...snapshot.labels.map((entry) => entry.id)]).size <= 500, { message: "Too many distinct session shortcuts" })
export type UiSyncSnapshot = z.infer<typeof uiSyncSnapshotSchema>
