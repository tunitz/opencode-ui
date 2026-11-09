import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openuidev/react-ui/Table"
import "@openuidev/react-ui/styles/table.css"

import { OpenUICodeBlock } from "@/components/openui-code-block"
import {
  ArtifactDialog,
  ArtifactRow,
} from "@/components/tool-artifacts"
import {
  artifactLinkCandidates,
  resolveArtifactLink,
} from "@/lib/artifact-links"
import { artifactSignature, type ToolArtifact } from "@/lib/tool-artifacts"
import { recordPerfRender } from "@/lib/perf-probe"

type TableAlignment = "left" | "center" | "right"

function tableAlignment(
  value: string | undefined,
  style: { textAlign?: string } | undefined
): TableAlignment | undefined {
  const resolved =
    value ??
    (typeof style?.textAlign === "string" ? style.textAlign : undefined)
  return resolved === "left" || resolved === "center" || resolved === "right"
    ? resolved
    : undefined
}

type HastNode = {
  tagName?: string
  children?: HastNode[]
}

function tableColumnCount(node: unknown): number {
  const table = node as HastNode | undefined
  const head = table?.children?.find((child) => child.tagName === "thead")
  const row = head?.children?.find((child) => child.tagName === "tr")
  return row?.children?.filter((child) => child.tagName === "th").length ?? 0
}

function extractFencedCode(children: ReactNode) {
  const child = Children.toArray(children).find(isValidElement)
  if (!child) {
    return null
  }

  const props = child.props as {
    className?: string
    children?: ReactNode
  }
  const className = typeof props.className === "string" ? props.className : ""
  const language =
    /(?:^|\s)language-([^\s]+)/.exec(className)?.[1] ?? ""

  return {
    code: String(props.children ?? ""),
    language,
  }
}

/**
 * Durable messages keep the same text while a different message streams, so
 * memoizing avoids re-parsing their Markdown on every live token.
 */
export const Markdown = memo(function Markdown({
  children,
  artifactSessionID = null,
  artifactExcludeSignatures = [],
  streaming = false,
}: {
  children: string
  artifactSessionID?: string | null
  artifactExcludeSignatures?: readonly string[]
  streaming?: boolean
}) {
  recordPerfRender("Markdown")
  const links = useMemo(() => artifactLinkCandidates(children), [children])
  const [resolved, setResolved] = useState<{
    sessionID: string | null
    artifacts: ToolArtifact[]
  }>({ sessionID: null, artifacts: [] })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const linkTriggerRef = useRef<HTMLAnchorElement | null>(null)
  const focusLinkOnCloseRef = useRef(false)

  useEffect(() => {
    if (!artifactSessionID || links.length === 0) return
    let cancelled = false
    void (async () => {
      const values = await Promise.all(
        links.map((href) =>
          resolveArtifactLink({ sessionID: artifactSessionID, href })
        )
      )
      if (cancelled) return
      setResolved((current) => {
        const base = current.sessionID === artifactSessionID ? current.artifacts : []
        const seen = new Set(base.map((artifact) => artifact.canonicalId ?? artifact.key))
        const next = [...base]
        for (const artifact of values) {
          if (!artifact) continue
          const id = artifact.canonicalId ?? artifact.key
          if (seen.has(id)) continue
          seen.add(id)
          next.push(artifact)
        }
        return { sessionID: artifactSessionID, artifacts: next }
      })
    })()
    return () => {
      cancelled = true
    }
  }, [artifactSessionID, links])

  const currentArtifacts =
    resolved.sessionID === artifactSessionID ? resolved.artifacts : []
  const excluded = useMemo(
    () => new Set(artifactExcludeSignatures),
    [artifactExcludeSignatures]
  )
  const rowArtifacts = currentArtifacts.filter(
    (artifact) => !excluded.has(artifactSignature(artifact))
  )
  const byHref = new Map(
    currentArtifacts
      .filter((artifact) => artifact.uri)
      .map((artifact) => [artifact.uri, artifact])
  )

  return (
    <div
      dir="auto"
      className="markdown-content min-w-0 space-y-3 text-base leading-6 break-words [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-medium [&_hr]:border-border [&_li]:my-1 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5"
    >
      <ReactMarkdown
        skipHtml
        disallowedElements={["img"]}
        urlTransform={defaultUrlTransform}
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const artifact = href ? byHref.get(href) : undefined
            if (artifact) {
              return (
                <a
                  href={href}
                  ref={(element) => {
                    if (element) linkTriggerRef.current = element
                  }}
                  aria-haspopup="dialog"
                  title={`Preview ${artifact.name}`}
                  onClick={(event) => {
                    event.preventDefault()
                    linkTriggerRef.current = event.currentTarget
                    focusLinkOnCloseRef.current = true
                    setSelectedKey(artifact.key)
                  }}
                >
                  {children}
                </a>
              )
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
          pre: ({ children }) => {
            const fenced = extractFencedCode(children)
            if (!fenced) {
              return (
                <pre className="max-w-full overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-[13px] leading-5">
                  {children}
                </pre>
              )
            }

            return (
              <OpenUICodeBlock
                code={fenced.code}
                language={fenced.language}
                streaming={streaming}
              />
            )
          },
          code: ({ children, className }) => (
            <code
              className={`rounded bg-muted/60 px-1 py-0.5 font-mono text-[0.9em] ${className ?? ""}`}
            >
              {children}
            </code>
          ),
          table: ({ children, node }) => {
            const columns = tableColumnCount(node)
            const compact = columns > 0 && columns <= 3
            return (
              <div className="openui-table-scope min-w-0 max-w-full">
                <Table
                  containerClassName={`openui-markdown-table${compact ? " openui-markdown-table-compact" : ""}`}
                  style={
                    !compact && columns > 3
                      ? { minWidth: `${columns * 9}rem` }
                      : undefined
                  }
                >
                  {children}
                </Table>
              </div>
            )
          },
          thead: ({ children }) => <TableHeader>{children}</TableHeader>,
          tbody: ({ children }) => <TableBody>{children}</TableBody>,
          tr: ({ children }) => <TableRow>{children}</TableRow>,
          th: ({ children, align, style }) => (
            <TableHead align={tableAlignment(align, style)}>
              {children}
            </TableHead>
          ),
          td: ({ children, align, style }) => (
            <TableCell align={tableAlignment(align, style)}>
              {children}
            </TableCell>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
      <ArtifactRow
        artifacts={rowArtifacts}
        onOpen={(key) => {
          focusLinkOnCloseRef.current = false
          setSelectedKey(key)
        }}
        label={`${rowArtifacts.length} linked artifact${rowArtifacts.length === 1 ? "" : "s"}`}
      />
      <ArtifactDialog
        artifacts={currentArtifacts}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onClose={() => {
          setSelectedKey(null)
          if (focusLinkOnCloseRef.current) {
            window.setTimeout(() => linkTriggerRef.current?.focus(), 50)
          }
          focusLinkOnCloseRef.current = false
        }}
      />
    </div>
  )
})
