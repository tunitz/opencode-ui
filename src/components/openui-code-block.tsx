import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { CheckIcon, CircleAlertIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { recordPerfRender } from "@/lib/perf-probe"
import {
  CODE_BLOCK_PREVIEW_LIMIT,
  codeBlockPreview,
  normalizeCodeLanguage,
} from "@/lib/code-block"

const LazyOpenUICodeBlock = lazy(
  () => import("@/components/openui-code-block-runtime")
)

type CopyStatus = "idle" | "copied" | "failed"

class OpenUICodeBlockErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

async function copyText(text: string, allowSelectionFallback: boolean): Promise<boolean> {
  const clipboard =
    typeof navigator === "undefined" ? undefined : navigator.clipboard

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the selection-based copy path.
    }
  }

  if (typeof document === "undefined" || !allowSelectionFallback) {
    return false
  }

  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.setAttribute("aria-hidden", "true")
  area.tabIndex = -1
  area.style.position = "fixed"
  area.style.inset = "0 auto auto 0"
  area.style.opacity = "0"
  area.style.pointerEvents = "none"
  document.body.appendChild(area)

  try {
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    area.remove()
  }
}

function PlainCodeBlock({
  code,
  languageLabel,
}: {
  code: string
  languageLabel: string
}) {
  return (
    <pre
      className="openui-code-fallback max-w-full overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-[13px] leading-5"
      dir="ltr"
      aria-label={`${languageLabel} code block`}
      tabIndex={0}
      style={{ paddingInlineEnd: "3.5rem", paddingTop: "3.5rem" }}
    >
      <code>{code}</code>
    </pre>
  )
}

export function OpenUICodeBlock({
  language: rawLanguage,
  code,
  streaming = false,
}: {
  language?: string
  code: string
  /** Live output: keep the full text readable without Prism re-highlighting each delta. */
  streaming?: boolean
}) {
  recordPerfRender("OpenUICodeBlock")
  const normalized = normalizeCodeLanguage(rawLanguage)
  const preview = codeBlockPreview(code)
  // Live output arrives token-by-token. Prism's full re-highlight on every
  // token is the measured main-thread hotspot. Keep the full source/copy bytes
  // in the active plaintext fallback while the run is live; durable/settled
  // blocks still use the actual OpenUI CodeBlock. This is a deliberate
  // streaming tradeoff, documented in COMPONENTS.md and covered by visual tests.
  const isStreaming = !preview.bounded && streaming
  const [copyResult, setCopyResult] = useState<{
    code: string
    status: CopyStatus
  }>({ code, status: "idle" })
  const copyStatus = copyResult.code === code ? copyResult.status : "idle"
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [downloadFailed, setDownloadFailed] = useState(false)

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current)
      }
    }
  }, [])

  async function handleCopy() {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }

    const copied = await copyText(code, !preview.bounded)
    setCopyResult({ code, status: copied ? "copied" : "failed" })

    if (copied) {
      resetTimer.current = setTimeout(() => {
        setCopyResult((current) =>
          current.code === code && current.status === "copied"
            ? { code, status: "idle" }
            : current
        )
        resetTimer.current = null
      }, 1600)
    }
  }

  const copyLabel =
    copyStatus === "copied"
      ? "Copied code"
      : copyStatus === "failed"
        ? preview.bounded ? "Copy unavailable. Download the full code instead." : "Copy unavailable. Select the code manually."
        : "Copy code"

  return (
    <div
      className="openui-code-shell relative min-w-0 max-w-full"
      data-openui-codeblock="true"
      data-language={normalized.highlight}
      data-fence-language={normalized.source}
      data-code-block-bounded={preview.bounded ? "true" : "false"}
      data-streaming-codeblock={isStreaming ? "true" : "false"}
      role="group"
      aria-label={`${normalized.label} code block`}
      dir="ltr"
    >
      {preview.bounded ? (
        <PlainCodeBlock
          code={preview.display}
          languageLabel={normalized.label}
        />
      ) : isStreaming ? (
        <PlainCodeBlock code={code} languageLabel={normalized.label} />
      ) : (
        <div
          tabIndex={0}
          aria-label={`${normalized.label} code scroll area`}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            const scrollable = event.currentTarget.querySelector("pre")
            if (!scrollable) return
            const offsets: Record<string, [number, number]> = {
              ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40],
              PageUp: [0, -scrollable.clientHeight], PageDown: [0, scrollable.clientHeight],
            }
            const offset = offsets[event.key]
            if (offset) {
              scrollable.scrollBy(offset[0], offset[1])
              event.preventDefault()
            }
          }}
        >
        <OpenUICodeBlockErrorBoundary
          fallback={
            <PlainCodeBlock code={code} languageLabel={normalized.label} />
          }
        >
          <Suspense
            fallback={
              <PlainCodeBlock code={code} languageLabel={normalized.label} />
            }
          >
            <LazyOpenUICodeBlock
              language={normalized.highlight}
              code={code}
            />
          </Suspense>
        </OpenUICodeBlockErrorBoundary>
        </div>
      )}

      <Button
        type="button"
        variant="secondary"
        size="icon-lg"
        className="openui-code-copy absolute end-2 top-2 z-10 size-11 border-border/80 bg-background/90 text-foreground shadow-sm backdrop-blur-sm hover:bg-muted"
        aria-label={copyLabel}
        title={copyLabel}
        data-openui-code-copy="true"
        onClick={() => void handleCopy()}
      >
        {copyStatus === "copied" ? (
          <CheckIcon aria-hidden="true" className="size-4" />
        ) : copyStatus === "failed" ? (
          <CircleAlertIcon aria-hidden="true" className="size-4" />
        ) : (
          <CopyIcon aria-hidden="true" className="size-4" />
        )}
      </Button>

      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        data-openui-copy-status="true"
      >
        {copyStatus === "copied"
          ? "Copied code."
          : copyStatus === "failed"
            ? preview.bounded ? "Copy unavailable. Download the full code instead." : "Copy unavailable. Select the code manually."
            : ""}
      </span>

      {preview.bounded ? (
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Preview limited to {CODE_BLOCK_PREVIEW_LIMIT.toLocaleString()} of{" "}
          {preview.total.toLocaleString()} characters. Copy code copies the full
          block.
          {" "}
          <button type="button" className="min-h-11 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => {
            try {
              const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }))
              const anchor = document.createElement("a")
              anchor.href = url
              anchor.download = "code.txt"
              document.body.appendChild(anchor)
              anchor.click()
              anchor.remove()
              window.setTimeout(() => URL.revokeObjectURL(url), 1000)
              setDownloadFailed(false)
            } catch {
              setDownloadFailed(true)
            }
          }}>Download full code</button>
          {downloadFailed ? <span role="alert"> Download could not be prepared.</span> : null}
        </p>
      ) : null}
    </div>
  )
}
