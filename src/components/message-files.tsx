import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import { useMemo, useRef, useState, type FocusEvent } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  ImageOffIcon,
} from "lucide-react"

import { PdfPreview } from "@/components/pdf-preview"
import { decodePreviewText } from "@/components/preview-text-data"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatFileSize, isSafeImageMime } from "@/lib/files"
import { cn } from "@/lib/utils"

export type DisplayFile = {
  name?: string | null
  mime: string
  dataUrl?: string
  size?: number | null
}

const MAX_INLINE_IMAGE_CHARS = 4_000_000
const MAX_TEXT_BYTES = 256 * 1024
const CODE_EXTENSIONS = /\.(md|mdx|txt|json|jsonc|js|jsx|ts|tsx|css|scss|html|htm|xml|svg|yaml|yml|toml|csv|log|py|rb|rs|go|java|c|cc|cpp|h|hpp|sh|zsh|sql|vue|svelte)$/i

type PreviewKind = "image" | "pdf" | "text" | null

function fileName(file: DisplayFile): string {
  return file.name?.trim() || "attachment"
}

function safeImage(file: DisplayFile): boolean {
  return Boolean(
    file.dataUrl &&
      file.dataUrl.length <= MAX_INLINE_IMAGE_CHARS &&
      isSafeImageMime(file.mime) &&
      file.dataUrl.startsWith("data:image/") &&
      !file.dataUrl.toLowerCase().startsWith("data:image/svg")
  )
}

function previewKind(file: DisplayFile): PreviewKind {
  if (safeImage(file)) return "image"
  if (!file.dataUrl?.startsWith("data:")) return null
  if (file.mime.toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name ?? "")) {
    return "pdf"
  }
  if (
    file.mime.toLowerCase().startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript"].includes(file.mime.toLowerCase()) ||
    CODE_EXTENSIONS.test(file.name ?? "")
  ) {
    return "text"
  }
  return null
}

function extension(file: DisplayFile): string | null {
  const match = (file.name ?? "").match(/\.([A-Za-z0-9]+)$/)
  return match?.[1]?.toLowerCase() ?? null
}

function decodeText(dataUrl: string): { text: string; truncated: boolean } | null {
  return decodePreviewText(dataUrl, MAX_TEXT_BYTES)
}

function TextPreview({ file }: { file: DisplayFile }) {
  const decoded = useMemo(
    () => (file.dataUrl ? decodeText(file.dataUrl) : null),
    [file.dataUrl]
  )

  if (!decoded) {
    return (
      <div role="alert" className="flex min-h-44 items-center justify-center p-6 text-sm text-destructive">
        Text preview is unavailable for this attachment.
      </div>
    )
  }

  const language = extension(file)
  const title = [
    fileName(file),
    language,
    decoded.truncated ? "preview truncated" : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <CodeBlock className="max-w-full">
        <CodeBlockHeader>
          <CodeBlockTitle title={title} dir="ltr">{title}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={decoded.text} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent wrap className="max-h-64" dir="ltr">
          {decoded.text}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  )
}

export function SafeImagePreview({
  file,
  className,
}: {
  file: DisplayFile
  className?: string
}) {
  if (!safeImage(file)) return null

  return (
    <img
      src={file.dataUrl}
      alt={fileName(file)}
      loading="lazy"
      className={cn(
        "max-h-48 max-w-full rounded-xl border border-border/60 object-contain",
        className
      )}
    />
  )
}

export function FileMetadata({
  file,
  className,
}: {
  file: DisplayFile
  className?: string
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{fileName(file)}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {file.mime}
        {typeof file.size === "number" ? ` · ${formatFileSize(file.size)}` : ""}
      </span>
    </span>
  )
}

function imageLabel(file: DisplayFile): string {
  return `${fileName(file)}, ${file.mime}`
}

function AttachmentChip({
  file,
  onPreview,
}: {
  file: DisplayFile
  onPreview: (kind: Exclude<PreviewKind, null>, trigger: HTMLButtonElement) => void
}) {
  const [failed, setFailed] = useState(false)
  const kind = previewKind(file)
  const isImage = kind === "image"
  // Large data URLs bypass the inline preview cap and fall back to this chip;
  // keep the name and size visible without ever rendering the oversized URL.
  const sizeLabel = typeof file.size === "number" ? formatFileSize(file.size) : null

  if (kind) {
    return (
      <Attachment
        state="done"
        size="sm"
        className={cn(
          "min-h-11 min-w-0 cursor-pointer overflow-hidden border border-border/70 bg-muted p-0 text-muted-foreground",
          // The installed Attachment primitive's horizontal orientation sets
          // min-w-40; min-w-0 keeps thumbnails at one 44px tile and lets the
          // file variant honour its own bounded max width.
          isImage ? "size-11 shrink-0 rounded-lg" : "max-w-[8.5rem] rounded-lg"
        )}
      >
        <AttachmentMedia
          variant={isImage ? "image" : "icon"}
          className={cn(
            "size-full rounded-none",
            isImage ? "bg-transparent" : "size-11"
          )}
        >
          {isImage ? (
            failed ? (
              <ImageOffIcon aria-hidden="true" className="size-4" />
            ) : (
              <img
                src={file.dataUrl}
                alt=""
                loading="lazy"
                className="size-full object-cover"
                onError={() => setFailed(true)}
              />
            )
          ) : (
            <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
          )}
        </AttachmentMedia>
        {isImage ? null : (
          <AttachmentContent className="pe-2">
            <AttachmentTitle className="text-xs">{fileName(file)}</AttachmentTitle>
            {sizeLabel ? (
              <AttachmentDescription className="text-[10px]">{sizeLabel}</AttachmentDescription>
            ) : null}
          </AttachmentContent>
        )}
        <AttachmentTrigger
          aria-label={`Preview ${imageLabel(file)}`}
          aria-haspopup="dialog"
          onClick={(event) => onPreview(kind, event.currentTarget)}
        />
      </Attachment>
    )
  }

  return (
    <Attachment
      state="done"
      size="sm"
      tabIndex={0}
      aria-label={`${imageLabel(file)}, preview unavailable`}
      className="flex min-h-11 min-w-0 max-w-[8.5rem] items-center overflow-hidden rounded-lg border border-border/70 bg-background/60 p-0 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
    >
      <AttachmentMedia variant="icon" className="size-11 rounded-none bg-transparent">
        <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
      </AttachmentMedia>
      <AttachmentContent className="pe-2">
        <AttachmentTitle className="text-xs">{fileName(file)}</AttachmentTitle>
        {sizeLabel ? (
          <AttachmentDescription className="text-[10px]">{sizeLabel}</AttachmentDescription>
        ) : null}
      </AttachmentContent>
    </Attachment>
  )
}

export function MessageFiles({ files }: { files: DisplayFile[] }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [previewError, setPreviewError] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  if (files.length === 0) return null

  const previewFile = previewIndex === null ? null : files[previewIndex]
  const kind = previewFile ? previewKind(previewFile) : null
  const imageItems = files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => safeImage(file))
  const imagePosition =
    previewIndex === null
      ? -1
      : imageItems.findIndex(({ index }) => index === previewIndex)

  function moveImage(delta: number) {
    if (imagePosition < 0 || imageItems.length < 2) return
    const next =
      (imagePosition + delta + imageItems.length) % imageItems.length
    setPreviewError(false)
    setPreviewIndex(imageItems[next].index)
  }

  // Native focus scrolling uses "nearest" semantics and can leave a wide chip
  // partly clipped. Fully reveal whichever chip receives focus (Tab, preview
  // close focus return, or pointer focus) in the strip's writing direction.
  function revealFocusedChip(event: FocusEvent<HTMLDivElement>) {
    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-slot="attachment"]')
    if (!chip) return
    // Defer past the browser's own "nearest" focus scroll; centering works in
    // both LTR and RTL without relying on signed scrollLeft values.
    requestAnimationFrame(() => {
      if (chip.isConnected) chip.scrollIntoView({ block: "nearest", inline: "center" })
    })
  }

  return (
    <>
      <div
        ref={rowRef}
        tabIndex={0}
        role="group"
        aria-label={`${files.length} attached file${files.length === 1 ? "" : "s"}`}
        onFocus={revealFocusedChip}
        className="flex w-full min-w-0 overflow-x-auto overscroll-x-contain scrollbar-thin py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        {/*
          min-w-full keeps short rows end-aligned; w-max lets long rows grow to
          their content so the logical start is reachable by local scrolling.
          justify-end no longer clips items: it only positions the short-row
          case, where there is no overflow to hide.
        */}
        <div className="flex w-max min-w-full shrink-0 items-center justify-end gap-1.5 px-1">
          {files.map((file, index) => (
            <AttachmentChip
              key={`${fileName(file)}-${index}`}
              file={file}
              onPreview={(nextKind, trigger) => {
                if (!nextKind) return
                triggerRef.current = trigger
                setPreviewError(false)
                setPreviewIndex(index)
              }}
            />
          ))}
        </div>
      </div>

      <Dialog
        open={previewIndex !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewIndex(null)
        }}
      >
        <ResponsiveDialogContent
          finalFocus={() => triggerRef.current?.isConnected ? triggerRef.current : rowRef.current}
          className="max-h-[92svh] w-[min(92vw,72rem)] max-w-[min(92vw,72rem)] gap-2 overflow-y-auto p-2 sm:max-w-[min(92vw,72rem)]"
          showCloseButton
        >
          <DialogTitle className="sr-only">
            {previewFile ? `Attachment preview: ${fileName(previewFile)}` : "Attachment preview"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {previewFile?.mime ?? "Attachment preview"}
          </DialogDescription>
          {previewFile && kind !== "text" && kind !== "image" ? (
            <p className="min-w-0 truncate pe-10 text-xs text-muted-foreground" dir="ltr">
              {fileName(previewFile)}
            </p>
          ) : null}
          {previewFile && kind === "pdf" ? (
            <PdfPreview dataUrl={previewFile.dataUrl ?? ""} name={fileName(previewFile)} allowDataDownload />
          ) : previewFile && kind === "text" ? (
            <TextPreview file={previewFile} />
          ) : previewFile && kind === "image" && !previewError ? (
            <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-muted/30 p-2">
              <div className="flex min-w-0 items-center gap-2 pe-10">
                <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 truncate" dir="ltr">
                  {fileName(previewFile)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {[
                    previewFile.mime,
                    typeof previewFile.size === "number"
                      ? formatFileSize(previewFile.size)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div
                className="mx-auto min-w-0 w-full"
                style={{ maxWidth: "min(100%, calc(52svh * 16 / 9))" }}
              >
                <img
                  src={previewFile.dataUrl ?? ""}
                  alt={fileName(previewFile)}
                  loading="lazy"
                  className="max-h-[52svh] w-full object-contain"
                  onError={() => setPreviewError(true)}
                />
              </div>
              {imageItems.length > 1 ? (
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    className="size-11 shrink-0"
                    aria-label="Previous image"
                    onClick={() => moveImage(-1)}
                  >
                    <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
                  </Button>
                  <span
                    className="min-w-0 text-center text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    Image {imagePosition + 1} of {imageItems.length}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    className="size-11 shrink-0"
                    aria-label="Next image"
                    onClick={() => moveImage(1)}
                  >
                    <ChevronRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
                  </Button>
                </div>
              ) : null}
            </div>
          ) : previewFile && kind === "image" ? (
            <div role="alert" className="flex min-h-44 items-center justify-center gap-2 p-6 text-sm text-destructive">
              <ImageOffIcon aria-hidden="true" className="size-5" />
              Image preview unavailable.
            </div>
          ) : (
            <div role="alert" className="flex min-h-44 items-center justify-center gap-2 p-6 text-sm text-destructive">
              <ImageOffIcon aria-hidden="true" className="size-5" />
              Preview unavailable for this attachment type.
            </div>
          )}
        </ResponsiveDialogContent>
      </Dialog>
    </>
  )
}
