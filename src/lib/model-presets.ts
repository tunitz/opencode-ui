export type ModelPreset = { name: string; agent: string; model: { providerID: string; id: string; variant?: string } }
const KEY = "opencode-ui:model-presets:v1"
export function readModelPresets(): ModelPreset[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    if (!Array.isArray(value)) return []
    return value.filter((item): item is ModelPreset => item && typeof item.name === "string" && !!item.name.trim() && typeof item.agent === "string" && !!item.agent && item.model && typeof item.model.providerID === "string" && !!item.model.providerID && typeof item.model.id === "string" && !!item.model.id && (item.model.variant === undefined || typeof item.model.variant === "string"))
  } catch { return [] }
}
export function writeModelPresets(presets: ModelPreset[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(presets)); return true } catch { return false }
}
