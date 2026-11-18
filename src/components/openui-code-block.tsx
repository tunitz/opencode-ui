import { useState } from "react"

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import {
  CODE_BLOCK_PREVIEW_LIMIT,
  codeBlockPreview,
  normalizeCodeLanguage,
} from "@/lib/code-block"
import { recordPerfRender } from "@/lib/perf-probe"

export function OpenUICodeBlock({
  language: rawLanguage,
  code,
  streaming = false,
}: {
  language?: string
  code: string
  /** Live output: keep the full text readable without re-highlighting each delta. */
  streaming?: boolean
}) {
  recordPerfRender("OpenUICodeBlock")
  const normalized = normalizeCodeLanguage(rawLanguage)
  const preview = codeBlockPreview(code)
  // Live output arrives token-by-token; CodeBlockContent takes a plain string,
  // so the full source stays readable without per-token re-highlighting.
  const isStreaming = !preview.bounded && streaming
  const [downloadFailed, setDownloadFailed] = useState(false)
  const display = preview.bounded ? preview.display : code

  return (
    <CodeBlock
      className="openui-code-shell min-w-0 max-w-full"
      data-openui-codeblock="true"
      data-language={normalized.highlight}
      data-fence-language={normalized.source}
      data-code-block-bounded={preview.bounded ? "true" : "false"}
      data-streaming-codeblock={isStreaming ? "true" : "false"}
      role="group"
      aria-label={`${normalized.label} code block`}
      dir="ltr"
    >
      <CodeBlockHeader>
        <CodeBlockTitle>{normalized.label}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} data-openui-code-copy="true" />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-w-full" dir="ltr">
        {display}
      </CodeBlockContent>
      {preview.bounded ? (
        <CodeBlockFooter className="flex-wrap text-xs">
          <p className="min-w-0 text-[11px] leading-5 text-muted-foreground">
            Preview limited to {CODE_BLOCK_PREVIEW_LIMIT.toLocaleString()} of{" "}
            {preview.total.toLocaleString()} characters. Copy copies the full
            block.{" "}
            <button
              type="button"
              className="min-h-11 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                try {
                  const url = URL.createObjectURL(
                    new Blob([code], { type: "text/plain;charset=utf-8" })
                  )
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
              }}
            >
              Download full code
            </button>
            {downloadFailed ? (
              <span role="alert"> Download could not be prepared.</span>
            ) : null}
          </p>
        </CodeBlockFooter>
      ) : null}
    </CodeBlock>
  )
}
