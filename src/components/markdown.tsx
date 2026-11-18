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
import { PaperclipIcon } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openuidev/react-ui/Table"
import "@openuidev/react-ui/styles/table.css"

import type { NoteAttachmentReference } from "@/components/note-attachment-dialog"
import { OpenUICodeBlock } from "@/components/openui-code-block"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import {
  ArtifactDialog,
  ArtifactRow,
} from "@/components/tool-artifacts"
import {
  artifactLinkCandidates,
  resolveArtifactLink,
} from "@/lib/artifact-links"
import {
  fsReadUrl,
  inferMime,
  isSafeImageMime,
  normalizeRelativePath,
} from "@/lib/files"
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

export type MarkdownNotes = {
  directory: string
  readAttachment: (id: string) => Promise<{
    attachment: {
      id: string
      name: string
      mime: string
      size: number
      createdAt?: number
    }
    data: string
  }>
  onOpenAttachment: (attachment: NoteAttachmentReference) => void
}

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(plainText).join("")
  if (isValidElement(node)) {
    return plainText((node.props as { children?: ReactNode }).children)
  }
  return ""
}

/**
 * Notes may only load project files that stay inside the linked project:
 * no schemes, protocol-relative URLs, absolute paths, or traversal.
 */
function noteProjectPath(url: string): string | null {
  if (!url || url.startsWith("#") || url.startsWith("//")) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(url)
  } catch {
    return null
  }
  const normalized = normalizeRelativePath(decoded)
  return normalized && normalized === decoded ? normalized : null
}

function notesUrlTransform(url: string): string {
  if (url.startsWith("attachment://")) return url
  return defaultUrlTransform(url)
}

function attachmentID(url: string | undefined): string | null {
  if (!url || !url.startsWith("attachment://")) return null
  const id = url.slice("attachment://".length)
  return /^[A-Za-z0-9._~-]+$/.test(id) ? id : null
}

function ProjectImage({
  directory,
  path,
  alt,
}: {
  directory: string
  path: string
  alt: string | undefined
}) {
  const normalized = noteProjectPath(path)
  if (
    !directory ||
    !normalized ||
    !isSafeImageMime(inferMime(normalized))
  ) {
    return (
      <span className="text-sm text-muted-foreground">
        {alt || "Image unavailable"}
      </span>
    )
  }
  return (
    <img
      src={fsReadUrl(directory, normalized)}
      alt={alt ?? ""}
      loading="lazy"
      className="my-1 max-h-96 max-w-full rounded-lg border object-contain"
    />
  )
}

type AttachmentImageState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "fallback"; attachment?: NoteAttachmentReference }

function NoteAttachmentImage({
  id,
  alt,
  notes,
}: {
  id: string
  alt: string | undefined
  notes: MarkdownNotes
}) {
  const [state, setState] = useState<AttachmentImageState>({
    status: "loading",
  })
  const { readAttachment } = notes

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) setState({ status: "loading" })
    })
    readAttachment(id).then(
      (result) => {
        if (!active) return
        if (
          result &&
          result.attachment &&
          isSafeImageMime(result.attachment.mime) &&
          typeof result.data === "string" &&
          /^[A-Za-z0-9+/]*={0,2}$/.test(result.data)
        ) {
          setState({
            status: "ready",
            url: `data:${result.attachment.mime};base64,${result.data}`,
          })
        } else {
          setState({
            status: "fallback",
            attachment: result?.attachment,
          })
        }
      },
      () => {
        if (active) setState({ status: "fallback" })
      }
    )
    return () => {
      active = false
    }
  }, [id, readAttachment])

  if (state.status === "ready") {
    return (
      <img
        src={state.url}
        alt={alt ?? ""}
        loading="lazy"
        className="my-1 max-h-96 max-w-full rounded-lg border object-contain"
      />
    )
  }
  if (state.status === "fallback" && state.attachment) {
    const attachment = state.attachment
    return (
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline underline-offset-2"
        onClick={() => notes.onOpenAttachment(attachment)}
      >
        <PaperclipIcon aria-hidden="true" className="size-4" />
        {alt || attachment.name}
      </button>
    )
  }
  return (
    <span className="text-sm text-muted-foreground">
      {state.status === "loading"
        ? alt
          ? `Loading ${alt}…`
          : "Loading image…"
        : alt || "Image unavailable"}
    </span>
  )
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
  notes,
}: {
  children: string
  artifactSessionID?: string | null
  artifactExcludeSignatures?: readonly string[]
  streaming?: boolean
  /** Notes-only rendering: project files and plugin attachments. Chat omits it. */
  notes?: MarkdownNotes
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
      className="markdown-content flex min-w-0 flex-col gap-3 text-base leading-6 break-words [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-medium [&_hr]:border-border [&_li]:my-1 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5"
    >
      <ReactMarkdown
        skipHtml
        disallowedElements={notes ? [] : ["img"]}
        urlTransform={notes ? notesUrlTransform : defaultUrlTransform}
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
            if (notes) {
              if (href?.startsWith("#"))
                return <a href={href}>{children}</a>
              const id = attachmentID(href)
              if (id) {
                const name = plainText(children) || "Attachment"
                return (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline underline-offset-2"
                    onClick={() =>
                      notes.onOpenAttachment({ id, name })
                    }
                  >
                    <PaperclipIcon aria-hidden="true" className="size-4" />
                    {children}
                  </button>
                )
              }
              const path = href ? noteProjectPath(href) : null
              if (path && notes.directory) {
                return (
                  <a
                    href={fsReadUrl(notes.directory, path)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                )
              }
              return <span>{children}</span>
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
          img: notes
            ? ({ src, alt }) => {
                const id = attachmentID(src)
                if (id)
                  return <NoteAttachmentImage id={id} alt={alt} notes={notes} />
                if (src)
                  return (
                    <ProjectImage
                      directory={notes.directory}
                      path={src}
                      alt={alt}
                    />
                  )
                return (
                  <span className="text-sm text-muted-foreground">
                    {alt || "Image unavailable"}
                  </span>
                )
              }
            : undefined,
          pre: ({ children }) => {
            const fenced = extractFencedCode(children)
            if (!fenced) {
              const code = plainText(children)
              return (
                <CodeBlock className="max-w-full">
                  <CodeBlockHeader>
                    <CodeBlockTitle>Code</CodeBlockTitle>
                    <CodeBlockActions>
                      <CodeBlockCopyButton value={code} />
                    </CodeBlockActions>
                  </CodeBlockHeader>
                  <CodeBlockContent wrap className="max-h-64">
                    {code}
                  </CodeBlockContent>
                </CodeBlock>
              )
            }

            // OpenUICodeBlock now composes the same shadcn CodeBlock parts and
            // keeps the bounded-preview and streaming-text behavior.
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
