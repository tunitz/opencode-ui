import { useEffect, useState } from "react"
import { DownloadIcon } from "lucide-react"

import { PdfPreview } from "@/components/pdf-preview"
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import type { NotesAdapter } from "@/components/notes-panel"
import {
  MAX_FILE_PREVIEW_BYTES,
  formatFileSize,
  isSafeImageMime,
} from "@/lib/files"

export type NoteAttachmentReference = {
  id: string
  name: string
  mime?: string
  size?: number
  createdAt?: number
}

const ACTIVE_MIME_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "application/x-javascript",
  "text/javascript",
  "application/ecmascript",
  "text/ecmascript",
])

/** SVG, HTML, and script payloads are refused before they reach a preview surface. */
export function isRejectedAttachmentMime(mime: string): boolean {
  return ACTIVE_MIME_TYPES.has(mime.toLowerCase())
}

export function attachmentDataURL(
  mime: string | undefined,
  data: string
): string | null {
  if (!mime || !data || isRejectedAttachmentMime(mime)) return null
  return `data:${mime};base64,${data}`
}

function isTextPreview(mime: string | undefined): boolean {
  if (!mime) return false
  const normalized = mime.toLowerCase()
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized.endsWith("+json") ||
    normalized === "application/xml" ||
    normalized.endsWith("+xml")
  )
}

function decodeText(data: string) {
  const maxEncodedLength = Math.ceil(MAX_FILE_PREVIEW_BYTES / 3) * 4
  const sliced =
    data.length > maxEncodedLength
      ? data.slice(0, maxEncodedLength - (maxEncodedLength % 4))
      : data
  const binary = atob(sliced)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return {
    text: new TextDecoder().decode(bytes),
    truncated: sliced.length < data.length,
  }
}

function downloadName(name: string): string {
  let result = ""
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0
    const unsafe =
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      /[\\/:*?"<>|]/.test(char)
    result += unsafe ? "_" : char
  }
  return result || "attachment"
}

function message(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  )
    return error.message
  return "Please try again."
}

/**
 * Reads an attachment only after the user opens it. Dialog owns focus return to
 * the trigger that opened it.
 */
export function NoteAttachmentDialog({
  noteID,
  attachment,
  adapter,
  onClose,
}: {
  noteID: string
  attachment: NoteAttachmentReference
  adapter: NotesAdapter
  onClose: () => void
}) {
  const readAttachment = adapter.readAttachment
  const [loaded, setLoaded] = useState<{
    attachment: NoteAttachmentReference
    data: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(!readAttachment)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      setLoaded(null)
      setError(null)
      setUnavailable(!readAttachment)
      setLoading(Boolean(readAttachment))
      if (!readAttachment) return
      readAttachment(noteID, attachment.id).then(
        (result) => {
          if (!active) return
          if (
            !result ||
            !result.attachment ||
            typeof result.data !== "string"
          ) {
            setError("The attachment response was invalid.")
          } else {
            setLoaded({
              attachment: result.attachment,
              data: result.data,
            })
          }
          setLoading(false)
        },
        (reason: unknown) => {
          if (!active) return
          setError(message(reason))
          setLoading(false)
        }
      )
    })
    return () => {
      active = false
    }
  }, [attachment.id, noteID, readAttachment])

  const meta = loaded?.attachment ?? attachment
  const mime = meta.mime
  const rejected = mime ? isRejectedAttachmentMime(mime) : false
  const dataUrl = loaded ? attachmentDataURL(mime, loaded.data) : null
  const textPreview =
    loaded && !rejected && isTextPreview(mime)
      ? (() => {
          try {
            return decodeText(loaded.data)
          } catch {
            return null
          }
        })()
      : null
  const canPreviewImage = Boolean(
    loaded && dataUrl && mime && isSafeImageMime(mime)
  )
  const canPreviewPdf = Boolean(
    loaded && dataUrl && mime === "application/pdf"
  )
  const canPreviewText = Boolean(loaded && textPreview)
  const canDownload = Boolean(loaded && dataUrl && !rejected)

  function download() {
    if (!canDownload || typeof document === "undefined") return
    const href = attachmentDataURL(mime, loaded?.data ?? "")
    if (!href) return
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = downloadName(meta.name)
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ResponsiveDialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words" dir="auto">
            {meta.name || "Attachment"}
          </DialogTitle>
          <DialogDescription>
            {mime ?? "Type unavailable"}
            {meta.size === undefined
              ? ""
              : ` · ${formatFileSize(meta.size)}`}
          </DialogDescription>
        </DialogHeader>
        {unavailable ? (
          <p role="status" className="text-sm text-muted-foreground">
            Attachments are unavailable. Update the notes plugin to read this
            file.
          </p>
        ) : loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading attachment…
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load this attachment. {error}
          </p>
        ) : rejected ? (
          <p role="alert" className="text-sm text-destructive">
            This file type cannot be previewed or downloaded.
          </p>
        ) : canPreviewImage ? (
          <img
            src={dataUrl ?? ""}
            alt={meta.name}
            className="mx-auto max-h-[60dvh] max-w-full rounded-lg border object-contain"
          />
        ) : canPreviewPdf ? (
          <PdfPreview
            dataUrl={dataUrl ?? ""}
            name={meta.name}
            allowDataDownload
          />
        ) : canPreviewText && textPreview ? (
          <div className="grid gap-2">
            <pre className="max-h-[55dvh] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
              {textPreview.text}
            </pre>
            {textPreview.truncated && (
              <p className="text-xs text-muted-foreground">
                Preview truncated after {formatFileSize(MAX_FILE_PREVIEW_BYTES)}.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border p-4 text-sm">
            <p>Preview unavailable for this file type.</p>
            {canDownload && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-fit"
                onClick={download}
              >
                <DownloadIcon aria-hidden="true" />
                Download file
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </ResponsiveDialogContent>
    </Dialog>
  )
}
