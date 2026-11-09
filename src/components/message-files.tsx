import { ResponsiveDialogContent } from "@/components/ui/responsive-dialog-content"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  ImageOffIcon,
} from "lucide-react"
import { Card } from "@openuidev/react-ui/Card"
import { CardHeader } from "@openuidev/react-ui/CardHeader"
import { Image } from "@openuidev/react-ui/Image"
import "@openuidev/react-ui/styles/card.css"
import "@openuidev/react-ui/styles/cardHeader.css"
import "@openuidev/react-ui/styles/image.css"

import { PdfPreview } from "@/components/pdf-preview"
import { decodePreviewText } from "@/components/preview-text-data"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  return (
    <div className="min-w-0 space-y-2">
      <div className="min-w-0 pe-12">
        <p className="break-all text-xs text-muted-foreground" dir="ltr">
          {fileName(file)}
          {language ? ` · ${language}` : ""}
          {decoded.truncated ? " · preview truncated" : ""}
        </p>
      </div>
      <ScrollArea viewportClassName="max-h-[68svh]" className="rounded-xl border border-border/70 bg-muted/30">
        <pre className="min-w-full p-3 font-mono text-[12px] leading-5 whitespace-pre" dir="ltr" tabIndex={0}>
          <code>{decoded.text}</code>
        </pre>
      </ScrollArea>
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

  if (kind) {
    return (
      <button
        type="button"
        aria-label={`Preview ${imageLabel(file)}`}
        aria-haspopup="dialog"
        onClick={(event) => onPreview(kind, event.currentTarget)}
        className={cn(
          "flex h-11 shrink-0 items-center justify-center gap-1.5 overflow-hidden border border-border/70 bg-muted text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
          kind === "image"
            ? "size-11 rounded-lg"
            : "max-w-[8.5rem] rounded-lg px-2 text-xs"
        )}
      >
        {kind === "image" ? (
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
          <>
            <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{fileName(file)}</span>
          </>
        )}
      </button>
    )
  }

  return (
    <span
      className="flex h-11 min-w-0 max-w-[8.5rem] shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-background/60 px-2 text-xs text-muted-foreground"
      aria-label={`${imageLabel(file)}, preview unavailable`}
    >
      <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{fileName(file)}</span>
    </span>
  )
}

export function MessageFiles({ files }: { files: DisplayFile[] }) {
  const [width, setWidth] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [previewError, setPreviewError] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const element = rowRef.current
    if (!element) return

    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (files.length === 0) return null

  const hasWideChip = files.some((file) => previewKind(file) !== "image")
  const slots =
    width < 340
      ? 2
      : width < 640
        ? hasWideChip
          ? 2
          : 3
        : 4
  const hasOverflow = files.length > slots
  const visibleCount = expanded
    ? files.length
    : Math.max(1, slots - (hasOverflow ? 1 : 0))
  const visible = files.slice(0, visibleCount)
  const hiddenCount = files.length - visibleCount
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

  return (
    <>
      <div
        ref={rowRef}
        tabIndex={-1}
        role="group"
        aria-label={`${files.length} attached file${files.length === 1 ? "" : "s"}`}
        className={cn(
          "flex w-full min-w-0 items-center justify-end gap-1.5",
          expanded ? "flex-wrap" : "flex-nowrap"
        )}
      >
        {visible.map((file, index) => (
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
        {hasOverflow ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 px-2.5 text-xs"
            aria-label={expanded ? "Show fewer attachments" : `Show ${hiddenCount} more attachment${hiddenCount === 1 ? "" : "s"}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : `+${hiddenCount} more`}
          </Button>
        ) : null}
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
            <Card
              variant="sunk"
              width="full"
              className="openui-rich-card min-w-0"
            >
              <CardHeader
                icon={<FileTextIcon aria-hidden="true" className="size-4" />}
                title={
                  <span className="block min-w-0 truncate" dir="ltr">
                    {fileName(previewFile)}
                  </span>
                }
                subtitle={[
                  previewFile.mime,
                  typeof previewFile.size === "number"
                    ? formatFileSize(previewFile.size)
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <div
                className="mx-auto min-w-0 w-full"
                style={{ maxWidth: "min(100%, calc(52svh * 16 / 9))" }}
              >
                <Image
                  src={previewFile.dataUrl ?? ""}
                  alt={fileName(previewFile)}
                  aspectRatio="16:9"
                  scale="fit"
                  className="w-full"
                  styles={{ maxHeight: "52svh" }}
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
            </Card>
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
