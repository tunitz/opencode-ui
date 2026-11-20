/**
 * Isolated fixture component for the sent-message attachment strip regression.
 *
 * Pure and side-effect free so an existing browser fixture can mount it.
 * Mounts the real MessageFiles component against synthetic screenshot files;
 * no engine, credentials, or network calls are involved.
 */
import { MessageFiles, type DisplayFile } from "@/components/message-files"
import { Message, MessageContent } from "@/components/ui/message"

export type MessageFilesCase = "one" | "three" | "mixed" | "many" | "binary"

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVEAAAAASUVORK5CYII="

function image(name: string): DisplayFile {
  return { name, mime: "image/png", dataUrl: PIXEL, size: 204_800 }
}

function documentFile(name: string): DisplayFile {
  return {
    name,
    mime: "application/pdf",
    dataUrl: "data:application/pdf;base64,JVBERi0xLjQ=",
    size: 1_048_576,
  }
}

export function filesForCase(testCase: MessageFilesCase): DisplayFile[] {
  if (testCase === "binary") {
    // No data URL: these chips have no preview trigger, so the strip itself
    // must be the keyboard route to every file.
    return Array.from({ length: 8 }, (_, index) => ({
      name: `archive-file-${index + 1}.bin`,
      mime: "application/octet-stream",
      size: 4096,
    }))
  }
  if (testCase === "many") {
    return [
      image("screenshot-01.png"),
      documentFile("a-very-long-contract-name-that-needs-truncation-final-v3.pdf"),
      image("screenshot-02.png"),
      documentFile("another-extremely-long-file-name-for-the-second-document-final.pdf"),
      image("screenshot-03.png"),
      documentFile("meeting-notes-export.md"),
      image("screenshot-04.png"),
      image("screenshot-05.png"),
    ]
  }
  if (testCase === "mixed") {
    return [
      image("screen-one.png"),
      documentFile("a-very-long-contract-name-that-needs-truncation-final-v3.pdf"),
      image("screen-two.png"),
    ]
  }
  if (testCase === "one") return [image("screenshot-01.png")]
  return [image("screenshot-01.png"), image("screenshot-02.png"), image("screenshot-03.png")]
}

export function MessageFilesFixture({ testCase }: { testCase?: MessageFilesCase }) {
  const selected =
    testCase ??
    (new URLSearchParams(window.location.search).get("case") as MessageFilesCase | null) ??
    "three"
  const files = filesForCase(selected)

  return (
    <div
      data-case={selected}
      className="mx-auto min-h-screen w-full max-w-md bg-background p-3 text-foreground"
    >
      <Message align="end">
        <MessageContent>
          <MessageFiles files={files} />
        </MessageContent>
      </Message>
    </div>
  )
}
