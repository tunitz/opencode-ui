export const CODE_BLOCK_RENDER_LIMIT = 50_000
export const CODE_BLOCK_PREVIEW_LIMIT = 20_000

const languageAliases: Record<string, string> = {
  bash: "bash",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  console: "bash",
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  "c#": "csharp",
  cs: "csharp",
  csharp: "csharp",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  diff: "diff",
  docker: "docker",
  dockerfile: "docker",
  go: "go",
  graphql: "graphql",
  gql: "graphql",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  java: "java",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  json5: "json5",
  kotlin: "kotlin",
  kt: "kotlin",
  make: "makefile",
  makefile: "makefile",
  md: "markdown",
  markdown: "markdown",
  objc: "objectivec",
  "objective-c": "objectivec",
  objectivec: "objectivec",
  perl: "perl",
  php: "php",
  plain: "text",
  plaintext: "text",
  text: "text",
  txt: "text",
  none: "text",
  powershell: "powershell",
  ps1: "powershell",
  proto: "protobuf",
  protobuf: "protobuf",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
}

const prismLanguages = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "docker",
  "go",
  "graphql",
  "java",
  "javascript",
  "json",
  "json5",
  "jsx",
  "kotlin",
  "less",
  "makefile",
  "markdown",
  "markup",
  "objectivec",
  "perl",
  "php",
  "powershell",
  "protobuf",
  "python",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "text",
  "toml",
  "tsx",
  "typescript",
  "yaml",
  "zig",
])

const languageLabels: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  docker: "Dockerfile",
  go: "Go",
  graphql: "GraphQL",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  json5: "JSON5",
  jsx: "JSX",
  kotlin: "Kotlin",
  less: "Less",
  makefile: "Makefile",
  markdown: "Markdown",
  markup: "HTML",
  objectivec: "Objective-C",
  perl: "Perl",
  php: "PHP",
  powershell: "PowerShell",
  protobuf: "Protocol Buffers",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  scss: "SCSS",
  sql: "SQL",
  swift: "Swift",
  text: "Text",
  toml: "TOML",
  tsx: "TSX",
  typescript: "TypeScript",
  yaml: "YAML",
  zig: "Zig",
}

export type NormalizedCodeLanguage = {
  highlight: string
  label: string
  source: string
}

/**
 * Resolve a Markdown fence language to the Prism language the OpenUI CodeBlock
 * receives. Unknown or unsafe-looking fences intentionally fall back to plain
 * text; the renderer never treats the fence as executable content.
 */
export function normalizeCodeLanguage(
  raw: string | null | undefined
): NormalizedCodeLanguage {
  const source = String(raw ?? "")
    .trim()
    .replace(/^language-/i, "")
    .toLowerCase()
  if (!source) {
    return { highlight: "text", label: "Text", source: "" }
  }

  const mapped = languageAliases[source] ?? source
  if (!prismLanguages.has(mapped)) {
    return { highlight: "text", label: "Text", source }
  }

  return {
    highlight: mapped,
    label: languageLabels[mapped] ?? mapped,
    source,
  }
}

export type CodeBlockPreview = {
  bounded: boolean
  display: string
  total: number
}

/**
 * Bound the amount of source mounted into the syntax renderer. The full source
 * is still available to the explicit copy action.
 */
export function codeBlockPreview(
  code: string,
  limit = CODE_BLOCK_RENDER_LIMIT,
  previewLimit = CODE_BLOCK_PREVIEW_LIMIT
): CodeBlockPreview {
  if (code.length <= limit) {
    return { bounded: false, display: code, total: code.length }
  }

  let end = Math.min(code.length, previewLimit)
  if (end > 0 && end < code.length) {
    const last = code.charCodeAt(end - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      end -= 1
    }
  }

  return {
    bounded: true,
    display: code.slice(0, end),
    total: code.length,
  }
}
