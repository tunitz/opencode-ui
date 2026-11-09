import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $getNodeByKey,
  $isElementNode,
  $isTextNode,
  $isRangeSelection,
  DecoratorNode,
  TextNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"
import { referenceRanges } from "@/lib/file-references"

type SerializedReference = Spread<
  { raw: string; path: string },
  SerializedLexicalNode
>
export class ReferenceNode extends DecoratorNode<React.ReactNode> {
  __raw: string
  __path: string
  static getType() {
    return "project-reference"
  }
  static clone(node: ReferenceNode) {
    return new ReferenceNode(node.__raw, node.__path, node.__key)
  }
  constructor(raw: string, path: string, key?: NodeKey) {
    super(key)
    this.__raw = raw
    this.__path = path
  }
  static importJSON(value: SerializedReference) {
    return new ReferenceNode(value.raw, value.path)
  }
  exportJSON(): SerializedReference {
    return {
      type: "project-reference",
      version: 1,
      raw: this.__raw,
      path: this.__path,
    }
  }
  createDOM() {
    const span = document.createElement("span")
    span.className = "inline"
    return span
  }
  updateDOM() {
    return false
  }
  isInline() {
    return true
  }
  getTextContent() {
    return this.__raw
  }
  decorate() {
    return (
      <ReferenceChip nodeKey={this.__key} path={this.__path} />
    )
  }
}
function ReferenceChip({
  nodeKey,
  path,
}: {
  nodeKey: NodeKey
  path: string
}) {
  const [editor] = useLexicalComposerContext()
  return (
    <span
      contentEditable={false}
      onKeyDown={(event) => event.stopPropagation()}
      className="inline-flex max-w-full items-baseline align-baseline"
      dir="ltr"
    >
      <button
        type="button"
        className="min-h-11 min-w-11 max-w-48 truncate text-primary underline underline-offset-2 focus-visible:outline-2"
        aria-label={`Preview file ${path}`}
        onClick={() =>
          editor
            .getRootElement()
            ?.dispatchEvent(
              new CustomEvent("reference-preview", {
                bubbles: true,
                detail: path,
              })
            )
        }
      >
        {path}
      </button>
      <button
        type="button"
        className="ms-1 min-h-11 min-w-11 text-muted-foreground focus-visible:outline-2"
        aria-label={`Edit reference ${path} as text`}
        onClick={() =>
          editor.update(() => {
            const node = $getNodeByKey(nodeKey)
            if (node instanceof ReferenceNode) $editReferenceAsText(node)
          })
        }
      >
        ✎
      </button>
    </span>
  )
}
export function $editReferenceAsText(node: ReferenceNode) {
  // Keep this editable text separate from its neighbours during Lexical's
  // normalization. The detail flag also survives splits and history restores.
  const text = $createTextNode(node.getTextContent()).toggleUnmergeable()
  node.replace(text)
  text.selectEnd()
}

export function registerReferenceTransform(editor: LexicalEditor) {
  return editor.registerNodeTransform(TextNode, (node) => {
    if (editor.isComposing()) return
    if (node.isUnmergeable()) {
      if (!node.getTextContent()) node.remove()
      return
    }
    const text = node.getTextContent()
    const range = referenceRanges(text)[0]
    if (!range) return
    const parts = node.splitText(range.start, range.end)
    const target = range.start === 0 ? parts[0] : parts[1]
    target.replace(
      new ReferenceNode(text.slice(range.start, range.end), range.path)
    )
  })
}
export function $loadComposerText(value: string) {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  root.append(paragraph)
  let position = 0
  for (const ref of referenceRanges(value)) {
    if (ref.start > position)
      paragraph.append($createTextNode(value.slice(position, ref.start)))
    paragraph.append(
      new ReferenceNode(value.slice(ref.start, ref.end), ref.path)
    )
    position = ref.end
  }
  if (position < value.length)
    paragraph.append($createTextNode(value.slice(position)))
}
export function $insertComposerPlainText(text: string) {
  let selection = $getSelection()
  if (!$isRangeSelection(selection)) {
    $getRoot().selectEnd()
    selection = $getSelection()
  }
  if ($isRangeSelection(selection)) selection.insertNodes([$createTextNode(text)])
}
function $offset(node: LexicalNode, offset: number): number {
  let result = $isElementNode(node)
    ? node
        .getChildren()
        .slice(0, offset)
        .reduce((sum, child) => sum + child.getTextContentSize(), 0)
    : offset
  let current: LexicalNode | null = node
  while (current && current.getParent()) {
    for (const sibling of current.getPreviousSiblings())
      result += sibling.getTextContentSize()
    current = current.getParent()
  }
  return result
}
export type ComposerEditorHandle = {
  focus: () => void
  insertPlainText: (text: string) => void
  selection: () => { start: number; end: number }
  setCaret: (offset: number) => void
}
type Props = {
  value: string
  sessionKey: string
  onChange: (value: string, start: number, end: number) => void
  onSelection: (value: string, start: number, end: number) => void
  onPreview: (path: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
  controls?: string
  activeDescendant?: string
}
function Bridge({
  value,
  sessionKey,
  onChange,
  onSelection,
  onPreview,
  editorRef,
}: Props & { editorRef: React.ForwardedRef<ComposerEditorHandle> }) {
  const [editor] = useLexicalComposerContext()
  const latest = useRef({ onChange, onSelection, onPreview })
  useEffect(() => {
    latest.current = { onChange, onSelection, onPreview }
  }, [onChange, onSelection, onPreview])
  const last = useRef({ value: "", sessionKey: "" })
  const lastSelection = useRef<{ start: number; end: number } | null>(null)
  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => editor.focus(),
      insertPlainText: (text) => editor.update(() => $insertComposerPlainText(text)),
      selection: () =>
        editor.getEditorState().read(() => {
          const sel = $getSelection()
          if (!$isRangeSelection(sel)) {
            const end = $getRoot().getTextContentSize()
            return lastSelection.current
              ? {
                  start: Math.min(lastSelection.current.start, end),
                  end: Math.min(lastSelection.current.end, end),
                }
              : { start: end, end }
          }
          const a = $offset(sel.anchor.getNode(), sel.anchor.offset),
            b = $offset(sel.focus.getNode(), sel.focus.offset)
          return { start: Math.min(a, b), end: Math.max(a, b) }
        }),
      setCaret: (offset) =>
        editor.update(() => {
          const paragraph = $getRoot().getFirstChild()
          if (!$isElementNode(paragraph)) return
          let remaining = offset
          for (const node of paragraph.getChildren()) {
            const size = node.getTextContentSize()
            if (remaining <= size && $isTextNode(node)) {
              node.select(Math.min(remaining, size), Math.min(remaining, size))
              return
            }
            remaining -= size
          }
          paragraph.selectEnd()
        }),
    }),
    [editor]
  )
  useEffect(() => {
    if (last.current.value === value && last.current.sessionKey === sessionKey)
      return
    last.current = { value, sessionKey }
    editor.update(() => $loadComposerText(value), { tag: "external-draft" })
  }, [editor, value, sessionKey])
  useEffect(() => registerReferenceTransform(editor), [editor])
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags }) => {
        if (tags.has("external-draft")) return
        editorState.read(() => {
          const text = $getRoot().getTextContent()
          const sel = $getSelection()
          let start = text.length,
            end = start
          if ($isRangeSelection(sel)) {
            const a = $offset(sel.anchor.getNode(), sel.anchor.offset),
              b = $offset(sel.focus.getNode(), sel.focus.offset)
            start = Math.min(a, b)
            end = Math.max(a, b)
            lastSelection.current = { start, end }
          }
          if (last.current.value !== text) {
            last.current.value = text
            latest.current.onChange(text, start, end)
          } else latest.current.onSelection(text, start, end)
        })
      }),
    [editor]
  )
  useEffect(() => {
    const root = editor.getRootElement()
    if (!root) return
    const listener = (event: Event) =>
      latest.current.onPreview((event as CustomEvent<string>).detail)
    root.addEventListener("reference-preview", listener)
    return () => root.removeEventListener("reference-preview", listener)
  }, [editor])
  return null
}
export const ComposerEditor = forwardRef<ComposerEditorHandle, Props>(
  function ComposerEditor(props, ref) {
    return (
      <LexicalComposer
        initialConfig={{
          namespace: "composer",
          nodes: [ReferenceNode],
          onError: (error) => {
            throw error
          },
        }}
      >
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Message"
              aria-multiline="true"
              aria-describedby="composer-status"
              aria-autocomplete="list"
              aria-controls={props.controls}
              aria-activedescendant={props.activeDescendant}
              data-composer-input
              className="max-h-40 min-h-10 w-full overflow-y-auto px-4 pt-3 pb-1 text-base leading-6 whitespace-pre-wrap text-foreground outline-none"
              onKeyDownCapture={(event) => {
                if (
                  event.target !== event.currentTarget &&
                  (event.target as HTMLElement).closest("button")
                )
                  return
                props.onKeyDown(event)
                if (event.defaultPrevented) event.stopPropagation()
              }}
              onPasteCapture={props.onPaste}
              onPointerDown={props.onPointerDown}
              onCompositionStart={(event) => { if (event.currentTarget.isConnected) props.onCompositionStart() }}
              onCompositionEnd={(event) => { if (event.currentTarget.isConnected) props.onCompositionEnd() }}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <Bridge {...props} editorRef={ref} />
      </LexicalComposer>
    )
  }
)
