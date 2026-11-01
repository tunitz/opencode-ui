import type { CSSProperties } from "react"

/**
 * Prism theme for the real OpenUI CodeBlock. The semantic colors are
 * code-specific CSS variables scoped to `.openui-code-shell`, so Light/Dark/
 * System follows the current app theme without an OpenUI provider or global
 * reset. Text/operator/punctuation remain on the app foreground for contrast;
 * the syntax colors are deliberately limited to code and used nowhere else.
 */
export const openUICodeTheme: Record<string, CSSProperties> = {
  'code[class*="language-"]': {
    color: "var(--foreground)",
    background: "none",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: "13px",
    lineHeight: "20px",
    direction: "ltr",
    textAlign: "left",
    whiteSpace: "pre",
    wordSpacing: "normal",
    wordBreak: "normal",
    tabSize: 2,
    hyphens: "none",
  },
  'pre[class*="language-"]': {
    color: "var(--foreground)",
    background: "color-mix(in oklch, var(--muted) 60%, transparent)",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: "13px",
    lineHeight: "20px",
    margin: 0,
    padding: "0.75rem",
    paddingInlineEnd: "3.5rem",
    overflowX: "auto",
    borderRadius: "0.5rem",
    textShadow: "none",
  },
  comment: { color: "var(--code-comment)", fontStyle: "italic" },
  prolog: { color: "var(--code-comment)", fontStyle: "italic" },
  doctype: { color: "var(--code-comment)", fontStyle: "italic" },
  cdata: { color: "var(--code-comment)", fontStyle: "italic" },
  property: { color: "var(--code-function)" },
  tag: { color: "var(--code-keyword)", fontWeight: 500 },
  boolean: { color: "var(--code-number)" },
  number: { color: "var(--code-number)" },
  constant: { color: "var(--code-number)" },
  symbol: { color: "var(--code-number)" },
  deleted: { color: "var(--code-number)" },
  selector: { color: "var(--code-function)" },
  "attr-name": { color: "var(--code-function)" },
  string: { color: "var(--code-string)" },
  char: { color: "var(--code-string)" },
  builtin: { color: "var(--code-function)" },
  inserted: { color: "var(--code-string)" },
  operator: { color: "var(--code-operator)" },
  entity: { color: "var(--code-number)" },
  url: { color: "var(--code-string)" },
  variable: { color: "var(--code-operator)" },
  atrule: { color: "var(--code-keyword)", fontWeight: 600 },
  "attr-value": { color: "var(--code-string)" },
  function: { color: "var(--code-function)", fontWeight: 600 },
  "class-name": { color: "var(--code-function)", fontWeight: 600 },
  keyword: { color: "var(--code-keyword)", fontWeight: 600 },
  namespace: { color: "var(--code-keyword)" },
  regex: { color: "var(--code-string)" },
  important: { color: "var(--code-keyword)", fontWeight: 600 },
  bold: { fontWeight: 600 },
  italic: { fontStyle: "italic" },
}
