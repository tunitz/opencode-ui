import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  ImageOffIcon,
  ZoomInIcon,
  ZoomOutIcon,
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
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  MAX_TOOL_ARTIFACT_TEXT_BYTES,
  MAX_TOOL_ARTIFACT_THUMBNAIL_BYTES,
  artifactSubtitle,
  sanitizeToolArtifactName,
  toolArtifactsFromContent,
  type ToolArtifact,
} from "@/lib/tool-artifacts"
import type { ToolFileContent } from "@/lib/opencode"
import { cn } from "@/lib/utils"
import { recordPerfRender } from "@/lib/perf-probe"

type ToolArtifactSource = {
  id: string
  name: string | null
  files: ToolFileContent[]
}

function decodeTextDataUrl(
  artifact: ToolArtifact
): { text: string; truncated: boolean } | null {
  return artifact.dataUrl ? decodePreviewText(artifact.dataUrl, MAX_TOOL_ARTIFACT_TEXT_BYTES) : null
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",")
  if (comma < 0) throw new Error("Malformed data URL")
  const header = dataUrl.slice(5, comma)
  const base64 = header.split(";").some((part) => part.toLowerCase() === "base64")
  const payload = dataUrl.slice(comma + 1)
  if (base64) {
    const binary = atob(payload)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  }
  return new TextEncoder().encode(decodeURIComponent(payload))
}

function downloadArtifact(artifact: ToolArtifact): boolean {
  if (!artifact.downloadable) return false
  if (artifact.downloadUrl) {
    try {
      const anchor = document.createElement("a")
      anchor.href = artifact.downloadUrl
      anchor.download = sanitizeToolArtifactName(artifact.name, artifact.mime)
      anchor.rel = "noopener"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      return true
    } catch {
      return false
    }
  }
  if (!artifact.dataUrl) return false
  try {
    const bytes = dataUrlToBytes(artifact.dataUrl)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    const blob = new Blob([buffer], { type: artifact.mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = sanitizeToolArtifactName(artifact.name, artifact.mime)
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

function ArtifactChip({
  artifact,
  onOpen,
}: {
  artifact: ToolArtifact
  onOpen: (trigger: HTMLButtonElement) => void
}) {
  const [failed, setFailed] = useState(false)
  const label = `${artifact.toolName ?? "tool"}: ${artifact.name}, ${artifact.mime}`
  const imageSrc = artifact.dataUrl ?? artifact.sourceUrl ?? null
  const isImage =
    artifact.kind === "image" &&
    imageSrc &&
    !failed &&
    (artifact.size === null || artifact.size <= MAX_TOOL_ARTIFACT_THUMBNAIL_BYTES)
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "shrink-0 justify-start gap-1.5 overflow-hidden p-0",
        isImage
          ? "size-11 rounded-lg"
          : "h-11 max-w-[9.5rem] rounded-lg px-2 text-xs"
      )}
      aria-label={`Open artifact ${label}`}
      aria-haspopup="dialog"
      title={label}
      onClick={(event) => {
        event.currentTarget.focus()
        onOpen(event.currentTarget)
      }}
    >
      {isImage ? (
        <img
          src={imageSrc ?? ""}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          {artifact.kind === "remote" ? (
            <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0" />
          ) : artifact.kind === "local" || artifact.kind === "unsupported" ? (
            <AlertCircleIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          ) : artifact.kind === "image" ? (
            <ImageOffIcon aria-hidden="true" className="size-4 shrink-0" />
          ) : artifact.kind === "pdf" || artifact.kind === "text" ? (
            <FileTextIcon aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <FileIcon aria-hidden="true" className="size-4 shrink-0" />
          )}
          <span className="min-w-0 truncate">{artifact.name}</span>
        </>
      )}
    </Button>
  )
}

function RouteTextPreview({ artifact }: { artifact: ToolArtifact }) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error"
    text: string
    truncated: boolean
  }>({ status: "loading", text: "", truncated: false })

  useEffect(() => {
    const source = artifact.sourceUrl
    if (!source) return
    let cancelled = false
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(source, {
          headers: { range: `bytes=0-${MAX_TOOL_ARTIFACT_TEXT_BYTES - 1}` },
          credentials: "same-origin",
          signal: controller.signal,
        })
        if (!response.ok) throw new Error("text unavailable")
        const body = await response.text()
        if (!cancelled) {
          setState({
            status: "ready",
            text: body.slice(0, MAX_TOOL_ARTIFACT_TEXT_BYTES),
            truncated: response.status === 206 || body.length > MAX_TOOL_ARTIFACT_TEXT_BYTES,
          })
        }
      } catch {
        if (!cancelled) setState({ status: "error", text: "", truncated: false })
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [artifact.sourceUrl])

  if (state.status === "error") {
    return (
      <div role="alert" className="flex min-h-44 items-center justify-center p-6 text-sm text-destructive">
        Text artifact preview is unavailable.
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs text-muted-foreground" dir="ltr">
        {artifact.name}
        {state.truncated ? " · preview truncated" : ""}
      </p>
      <ScrollArea viewportClassName="max-h-[62svh]" className="rounded-xl border border-border/70 bg-muted/30">
        <pre className="min-w-full p-3 font-mono text-[12px] leading-5 whitespace-pre" dir="ltr" tabIndex={0}>
          <code>{state.status === "loading" ? "Loading artifact…" : state.text}</code>
        </pre>
      </ScrollArea>
    </div>
  )
}

function ArtifactImagePreview({ artifact }: { artifact: ToolArtifact }) {
  const [failed, setFailed] = useState(false)
  const [dimensions, setDimensions] = useState({
    width: artifact.width ?? 0,
    height: artifact.height ?? 0,
  })
  const [zoom, setZoom] = useState(1)
  const source = artifact.dataUrl ?? artifact.sourceUrl ?? null
  const tall = dimensions.width > 0 && dimensions.height > dimensions.width * 1.4

  if (!source || failed) {
    return (
      <div role="alert" className="flex min-h-44 items-center justify-center gap-2 p-6 text-sm text-destructive">
        <ImageOffIcon aria-hidden="true" className="size-5" />
        Image preview unavailable.
      </div>
    )
  }

  const onLoad = (element: HTMLImageElement) => {
    setDimensions({
      width: element.naturalWidth,
      height: element.naturalHeight,
    })
  }

  // OpenUI Image 0.18.1 exposes only fixed aspect ratios (1:1/3:2/3:4/4:3/16:9);
  // a full-page 1440x3516 screenshot would be cropped. Tall screenshots use a
  // bounded scroll/zoom image inside the same existing Dialog; normal images still
  // use the actual OpenUI Image below.
  if (tall) {
    return (
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="size-11"
            aria-label="Zoom out artifact image"
            disabled={zoom <= 1}
            onClick={() => setZoom((current) => Math.max(1, Number((current - 0.5).toFixed(1))))}
          >
            <ZoomOutIcon aria-hidden="true" className="size-4" />
          </Button>
          <span className="min-w-20 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="size-11"
            aria-label="Zoom in artifact image"
            disabled={zoom >= 4}
            onClick={() => setZoom((current) => Math.min(4, Number((current + 0.5).toFixed(1))))}
          >
            <ZoomInIcon aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-3 text-xs"
            aria-label="Fit artifact image to width"
            onClick={() => setZoom(1)}
          >
            Fit width
          </Button>
        </div>
        <ScrollArea
          viewportClassName="max-h-[62svh]"
          className="w-full rounded-xl border border-border/70 bg-muted/30 p-2"
          data-artifact-scroll="true"
        >
          <img
            src={source}
            alt={artifact.name}
            data-artifact-image="true"
            loading="eager"
            className="mx-auto block h-auto max-w-none"
            style={{ width: `${zoom * 100}%` }}
            onLoad={(event) => onLoad(event.currentTarget)}
            onError={() => setFailed(true)}
          />
        </ScrollArea>
      </div>
    )
  }

  return (
    <div
      className="mx-auto min-w-0 w-full"
      style={{ maxWidth: "min(100%, calc(52svh * 16 / 9))" }}
    >
      <Image
        src={source}
        alt={artifact.name}
        aspectRatio="16:9"
        scale="fit"
        className="w-full"
        styles={{ maxHeight: "52svh" }}
        data-artifact-image="true"
        onLoad={(event) => onLoad(event.currentTarget)}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function ArtifactBody({ artifact }: { artifact: ToolArtifact }) {
  const text = useMemo(
    () => (artifact.kind === "text" && artifact.dataUrl ? decodeTextDataUrl(artifact) : null),
    [artifact]
  )

  if (artifact.kind === "image") {
    return <ArtifactImagePreview key={artifact.key} artifact={artifact} />
  }

  if (artifact.kind === "pdf" && (artifact.dataUrl || artifact.sourceUrl)) {
    return (
      <PdfPreview
        dataUrl={artifact.dataUrl ?? undefined}
        url={artifact.sourceUrl ?? undefined}
        name={artifact.name}
        allowDataDownload
      />
    )
  }

  if (artifact.kind === "text" && artifact.sourceUrl) {
    return <RouteTextPreview artifact={artifact} />
  }

  if (artifact.kind === "text") {
    return text ? (
      <div className="min-w-0 space-y-2">
        <p className="text-xs text-muted-foreground" dir="ltr">
          {artifact.name}
          {text.truncated ? " · preview truncated" : ""}
        </p>
        <ScrollArea viewportClassName="max-h-[62svh]" className="rounded-xl border border-border/70 bg-muted/30">
          <pre className="min-w-full p-3 font-mono text-[12px] leading-5 whitespace-pre" dir="ltr" tabIndex={0}>
            <code>{text.text}</code>
          </pre>
        </ScrollArea>
      </div>
    ) : (
      <div role="alert" className="flex min-h-44 items-center justify-center p-6 text-sm text-destructive">
        Text artifact preview is unavailable.
      </div>
    )
  }

  if (artifact.kind === "remote") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{artifact.reason}</p>
        {artifact.remoteUrl ? (
          <a
            href={artifact.remoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLinkIcon aria-hidden="true" className="size-4" />
            Open remote artifact
          </a>
        ) : null}
      </div>
    )
  }

  return (
    <p className="text-sm text-muted-foreground">
      {artifact.reason ?? "No inline preview is available for this artifact."}
    </p>
  )
}

export function ArtifactDialog({
  artifacts,
  selectedKey,
  onSelect,
  onClose,
  returnFocus,
}: {
  artifacts: ToolArtifact[]
  selectedKey: string | null
  onSelect: (key: string | null) => void
  onClose: () => void
  returnFocus?: RefObject<HTMLElement | null>
}) {
  const artifact = artifacts.find((item) => item.key === selectedKey) ?? null
  const imageArtifacts = artifacts.filter(
    (item) => item.kind === "image" && (item.dataUrl || item.sourceUrl)
  )
  const imagePosition = artifact
    ? imageArtifacts.findIndex((item) => item.key === artifact.key)
    : -1
  const [downloadFailed, setDownloadFailed] = useState(false)
  const close = () => {
    setDownloadFailed(false)
    onClose()
  }

  return (
    <Dialog
      open={artifact !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        finalFocus={() => {
          const target = returnFocus?.current
          return target?.isConnected ? target : null
        }}
        className="max-h-[92svh] w-[min(92vw,72rem)] max-w-[min(92vw,72rem)] gap-2 overflow-y-auto p-2 sm:max-w-[min(92vw,72rem)]"
        showCloseButton
      >
        <DialogTitle className="sr-only">
          {artifact ? `Artifact preview: ${artifact.name}` : "Artifact preview"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {artifact ? `${artifact.toolName ?? "Tool"} · ${artifact.mime}` : "Artifact preview"}
        </DialogDescription>
        {artifact ? (
          <Card
            variant="sunk"
            width="full"
            className="openui-rich-card min-w-0"
          >
            <CardHeader
              icon={
                artifact.kind === "image" ? (
                  <FileIcon aria-hidden="true" className="size-4" />
                ) : (
                  <FileTextIcon aria-hidden="true" className="size-4" />
                )
              }
              title={
                <span className="block min-w-0 truncate" dir="ltr">
                  {artifact.name}
                </span>
              }
              subtitle={`${artifact.toolName ?? "tool"} · ${artifactSubtitle(artifact)}`}
            />
            <ArtifactBody key={artifact.key} artifact={artifact} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {imageArtifacts.length > 1 && imagePosition >= 0 ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    className="size-11"
                    aria-label="Previous image artifact"
                    onClick={() => {
                      const next =
                        imageArtifacts[
                          (imagePosition - 1 + imageArtifacts.length) %
                            imageArtifacts.length
                        ]
                      if (next) {
                        setDownloadFailed(false)
                        onSelect(next.key)
                      }
                    }}
                  >
                    <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Image {imagePosition + 1} of {imageArtifacts.length}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-lg"
                    className="size-11"
                    aria-label="Next image artifact"
                    onClick={() => {
                      const next =
                        imageArtifacts[
                          (imagePosition + 1) % imageArtifacts.length
                        ]
                      if (next) {
                        setDownloadFailed(false)
                        onSelect(next.key)
                      }
                    }}
                  >
                    <ChevronRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
                  </Button>
                </div>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                {artifact.downloadable ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    onClick={() => {
                      const ok = downloadArtifact(artifact)
                      setDownloadFailed(!ok)
                    }}
                  >
                    <DownloadIcon aria-hidden="true" className="size-4" />
                    Download
                  </Button>
                ) : null}
              </div>
            </div>
            {downloadFailed ? (
              <p role="alert" className="text-xs text-destructive">
                Download could not be prepared from this artifact.
              </p>
            ) : null}
          </Card>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function ArtifactRow({
  artifacts,
  onOpen,
  label,
}: {
  artifacts: ToolArtifact[]
  onOpen: (key: string, trigger: HTMLButtonElement) => void
  label?: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (artifacts.length === 0) return null
  const slots = artifacts.length > 3 ? 2 : Math.max(1, artifacts.length)
  const visible = expanded ? artifacts : artifacts.slice(0, slots)
  const hidden = artifacts.length - visible.length
  return (
    <div
      role="group"
      aria-label={label ?? `${artifacts.length} tool-delivered file${artifacts.length === 1 ? "" : "s"}`}
      className="mt-1 flex w-full min-w-0 flex-wrap items-center gap-1.5"
    >
      {visible.map((artifact) => (
        <ArtifactChip
          key={artifact.key}
          artifact={artifact}
          onOpen={(trigger) => onOpen(artifact.key, trigger)}
        />
      ))}
      {artifacts.length > slots ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 px-2.5 text-xs"
          aria-label={expanded ? "Show fewer artifacts" : `Show ${hidden} more artifact${hidden === 1 ? "" : "s"}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : `+${hidden} more`}
        </Button>
      ) : null}
    </div>
  )
}

export function ToolArtifacts({ tools }: { tools: ToolArtifactSource[] }) {
  recordPerfRender("ToolArtifacts")
  const artifacts = useMemo(() => {
    const seen = new Set<string>()
    const result: ToolArtifact[] = []
    for (const tool of tools) {
      for (const artifact of toolArtifactsFromContent({
        content: tool.files,
        toolID: tool.id,
        toolName: tool.name,
      })) {
        if (seen.has(artifact.dedupeKey)) continue
        seen.add(artifact.dedupeKey)
        result.push(artifact)
      }
    }
    return result
  }, [tools])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  if (artifacts.length === 0) return null

  return (
    <>
      <ArtifactRow
        artifacts={artifacts}
        onOpen={(key, trigger) => {
          triggerRef.current = trigger
          setSelectedKey(key)
        }}
      />
      <ArtifactDialog
        artifacts={artifacts}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onClose={() => setSelectedKey(null)}
        returnFocus={triggerRef}
      />
    </>
  )
}
