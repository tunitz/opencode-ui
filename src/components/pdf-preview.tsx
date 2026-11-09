import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

const MAX_PDF_CHARS = 12_000_000

function pdfBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",")
  if (comma < 0 || dataUrl.length > MAX_PDF_CHARS) return null
  try {
    const binary = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function safePdfFilename(name: string): string {
  let out = ""
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0
    const unsafe =
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      /[\\/:*?"<>|]/.test(char)
    out += unsafe ? "_" : char
  }
  return out || "attachment.pdf"
}

type PdfDocument = {
  numPages: number
  getPage: (page: number) => Promise<{
    getViewport: (options: { scale: number }) => { width: number; height: number }
    getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>
    render: (options: Record<string, unknown>) => { promise: Promise<void>; cancel: () => void }
  }>
}

export function PdfPreview({
  dataUrl,
  url,
  name,
  allowDataDownload = false,
}: {
  dataUrl?: string
  url?: string
  name: string
  allowDataDownload?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<PdfDocument | null>(null)
  const loadingTaskRef = useRef<{ destroy: () => Promise<void> } | null>(null)
  const renderRef = useRef<{ cancel: () => void } | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [downloadError, setDownloadError] = useState(false)
  const [pageText, setPageText] = useState<{ page: number; text: string } | null>(null)

  const canDownload = allowDataDownload && !!dataUrl && /^data:application\/pdf(?:;[^,]*)?;base64,/i.test(dataUrl) && dataUrl.length <= MAX_PDF_CHARS
  function downloadOriginal() {
    try {
      const bytes = dataUrl ? pdfBytes(dataUrl) : null
      if (!bytes) throw new Error("Invalid PDF")
      const buffer = new ArrayBuffer(bytes.length)
      new Uint8Array(buffer).set(bytes)
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }))
      const anchor = document.createElement("a")
      anchor.href = blobUrl
      anchor.download = safePdfFilename(name)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
      setDownloadError(false)
    } catch {
      setDownloadError(true)
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) setPageText(null) })
    const bytes = dataUrl ? pdfBytes(dataUrl) : null

    if ((!dataUrl && !url) || (dataUrl && !bytes)) {
      void Promise.resolve().then(() => {
        setStatus("error")
        setError("PDF preview is unavailable (invalid or oversized data).")
      })
      return
    }

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist")
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const task = pdfjs.getDocument(bytes ? { data: bytes } : { url: url as string })
        loadingTaskRef.current = task
        const doc = (await task.promise) as unknown as PdfDocument
        if (cancelled) {
          await task.destroy()
          return
        }
        documentRef.current = doc
        setPageCount(doc.numPages)
        setPage(1)
        setStatus("ready")
      } catch {
        if (!cancelled) {
          setStatus("error")
          setError("PDF preview could not be opened.")
        }
      }
    })()

    return () => {
      cancelled = true
      renderRef.current?.cancel()
      renderRef.current = null
      const task = loadingTaskRef.current
      loadingTaskRef.current = null
      documentRef.current = null
      if (task) void task.destroy()
    }
  }, [dataUrl, url])

  useEffect(() => {
    if (status !== "ready") return
    const doc = documentRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas) return
    let cancelled = false

    void (async () => {
      try {
        renderRef.current?.cancel()
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        void pdfPage.getTextContent().then((content) => {
          if (cancelled) return
          let text = ""
          for (const item of content.items) {
            if (typeof item.str !== "string") continue
            text += item.str + (item.hasEOL ? "\n" : " ")
            if (text.length >= 256 * 1024) {
              text = `${text.slice(0, 256 * 1024)}\nPage text truncated.`
              break
            }
          }
          setPageText({ page, text: text.trim() })
        }).catch(() => { if (!cancelled) setPageText(null) })
        const viewport = pdfPage.getViewport({ scale })
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Canvas unavailable")
        const task = pdfPage.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        })
        renderRef.current = task
        await task.promise
      } catch {
        if (!cancelled) {
          setStatus("error")
          setError("PDF page could not be rendered.")
        }
      }
    })()

    return () => {
      cancelled = true
      renderRef.current?.cancel()
      renderRef.current = null
    }
  }, [page, scale, status])

  const fitWidth = useCallback(() => {
    const width = viewportRef.current?.clientWidth
    if (!width || !documentRef.current) return
    void documentRef.current.getPage(page).then((pdfPage) => {
      const base = pdfPage.getViewport({ scale: 1 })
      setScale(Math.max(0.5, Math.min(3, (width - 24) / base.width)))
    })
  }, [page])

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs text-muted-foreground">The PDF preview is an image. Extracted page text may be incomplete or unavailable, especially for scanned pages. {canDownload ? "Download the original to read it with an accessible PDF reader." : "Use the original PDF in an accessible reader if available."}</p>
      {canDownload ? <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={downloadOriginal}>Download original PDF</Button> : null}
      {downloadError ? <p role="alert" className="text-xs text-destructive">PDF download could not be prepared.</p> : null}
      {status === "error" ? <div role="alert" className="flex min-h-44 items-center justify-center p-6 text-sm text-destructive">{error ?? "PDF preview unavailable."}</div> : <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" className="h-11 px-3 text-xs" aria-label="Previous PDF page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Button>
        <span className="min-w-20 text-center text-xs tabular-nums text-muted-foreground">
          Page {page} of {pageCount || "…"}
        </span>
        <Button type="button" variant="outline" className="h-11 px-3 text-xs" aria-label="Next PDF page" disabled={!pageCount || page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
          <ChevronRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Button>
        <Button type="button" variant="outline" className="h-11 px-3 text-xs" aria-label="Zoom out PDF" disabled={scale <= 0.5} onClick={() => setScale((current) => Math.max(0.5, current - 0.2))}>
          <ZoomOutIcon aria-hidden="true" className="size-4" />
        </Button>
        <Button type="button" variant="outline" className="h-11 px-3 text-xs" aria-label="Zoom in PDF" disabled={scale >= 3} onClick={() => setScale((current) => Math.min(3, current + 0.2))}>
          <ZoomInIcon aria-hidden="true" className="size-4" />
        </Button>
        <Button type="button" variant="outline" className="h-11 px-3 text-xs" aria-label="Fit PDF to width" onClick={fitWidth}>
          Fit width
        </Button>
      </div>
      <div ref={viewportRef} className="min-w-0">
        <ScrollArea viewportClassName="max-h-[68svh]" className="w-full rounded-xl border border-border/70 bg-muted/30 p-2">
          <div className="min-w-max">
            {status === "loading" ? (
              <p role="status" className="p-4 text-xs text-muted-foreground">Loading PDF…</p>
            ) : null}
            <canvas ref={canvasRef} role="img" aria-label={`Visual preview of ${name}, page ${page} of ${pageCount || "unknown"}`} className="mx-auto block max-w-none bg-white" />
            {pageText?.page === page && pageText.text ? <div className="sr-only" aria-label={`Extracted text from page ${page}`}><p>{pageText.text}</p></div> : null}
          </div>
        </ScrollArea>
      </div>
      </>}
    </div>
  )
}
