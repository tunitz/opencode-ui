import type { ModelRef } from "@/lib/opencode"

/**
 * The only model this step is allowed to prompt. Verified against the live
 * catalog immediately before live testing: provider `opencode`, input/output/
 * cache costs 0, status active, enabled. Re-verify before enabling prompting.
 */
export const VERIFIED_FREE_MODEL = {
  providerID: "opencode",
  id: "deepseek-v4.1-flash-free",
} as const

export type ModelLike =
  | Pick<ModelRef, "id" | "providerID">
  | { id: string; providerID: string }
  | null
  | undefined

export function isVerifiedFreeModel(model: ModelLike): boolean {
  return (
    model?.providerID === VERIFIED_FREE_MODEL.providerID &&
    model.id === VERIFIED_FREE_MODEL.id
  )
}

export function modelLabel(model: ModelLike): string {
  return model ? `${model.providerID}/${model.id}` : "No model"
}
