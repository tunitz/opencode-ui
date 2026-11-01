import { CodeBlock } from "@openuidev/react-ui/CodeBlock"
import "@openuidev/react-ui/styles/codeBlock.css"

import { openUICodeTheme } from "@/components/openui-code-block-theme"
import { recordPerfRender } from "@/lib/perf-probe"

export default function OpenUICodeBlockRuntime({
  language,
  code,
}: {
  language: string
  code: string
}) {
  recordPerfRender("PrismCodeBlock")
  return (
    <div data-openui-codeblock-runtime="true">
      <CodeBlock
        language={language}
        codeString={code}
        theme={openUICodeTheme}
      />
    </div>
  )
}
