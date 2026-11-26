import { describe, expect, test } from "bun:test"

import {
  isSafeImage,
  toAttachmentView,
  toContextView,
  toPermissionView,
  toQueueItem,
  toReasoningLine,
  toSourceView,
  toTraceLine,
  toCheckpointView,
  traceValue,
} from "../src/lib/shadcn-ai"

describe("traceValue security boundary", () => {
  test("allows short human-readable labels", () => {
    expect(traceValue("read File.ts", 40)).toBe("read File.ts")
  })

  test("rejects secrets, commands, paths and long tokens", () => {
    expect(traceValue("api key abc", 40)).toBeNull()
    expect(traceValue("password hunter2", 40)).toBeNull()
    expect(traceValue("/home/user/.config", 40)).toBeNull()
    expect(traceValue("a".repeat(32), 80)).toBeNull()
    expect(traceValue("rm -rf /", 40)).toBeNull()
    expect(traceValue("short", 3)).toBeNull()
  })

  test("tool headings keep sanitized detail only", () => {
    const line = toTraceLine(
      {
        id: "1",
        name: "task",
        status: "completed",
        input: { agent: "explore", description: "map components", prompt: "secret token" },
      },
      false
    )
    expect(line.title).toBe("Ran explore — map components · task")
    expect(line.title).not.toContain("secret")
    expect(line.title).not.toContain("token")
  })
})

describe("trace status mapping", () => {
  test("running while streaming, error when stopped", () => {
    const tool = { id: "1", name: "bash", status: "running" as const }
    expect(toTraceLine(tool, true)).toEqual({
      status: "running",
      title: "Running bash",
    })
    expect(toTraceLine(tool, false)).toEqual({
      status: "error",
      title: "Running bash",
    })
  })

  test("failed tools are error lines", () => {
    expect(toTraceLine({ id: "2", name: "edit", status: "error" }, false).status).toBe("error")
  })

  test("reasoning shimmers only while streaming", () => {
    expect(toReasoningLine("thinking", true).status).toBe("running")
    expect(toReasoningLine("done thinking", false).status).toBeUndefined()
  })
})

describe("permission, queue and context adapters", () => {
  test("permission savability follows save patterns", () => {
    const view = toPermissionView({
      action: "bash",
      resources: ["src/**"],
      save: ["bash"],
    })
    expect(view.savable).toBe(true)
    expect(view.resources).toEqual(["src/**"])
  })

  test("queue section follows todo status", () => {
    expect(toQueueItem({ id: "a", content: "one", status: "in_progress" }).section).toBe("todo")
    expect(toQueueItem({ id: "b", content: "two", status: "completed" }).section).toBe("completed")
    expect(toQueueItem({ id: "c", content: "three" }).status).toBe("pending")
  })

  test("context percent is clamped and missing limits stay missing", () => {
    expect(toContextView({ input: 50, output: 50 }, 100)).toEqual({
      used: 100,
      limit: 100,
      percent: 100,
    })
    expect(toContextView({ input: 200, output: 0 }, 100)?.percent).toBe(100)
    expect(toContextView({ input: 1 }, 0)).toBeNull()
  })
})

describe("attachment and checkpoint adapters", () => {
  const safeMime = (mime: string) => ["image/png", "image/jpeg"].includes(mime)

  test("rejects SVG image data URLs", () => {
    const file = {
      name: "icon.svg",
      mime: "image/svg+xml",
      dataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
    }
    expect(isSafeImage(file, safeMime)).toBe(false)
    expect(toAttachmentView(file, safeMime).imageUrl).toBeUndefined()
  })

  test("keeps safe raster images", () => {
    const file = {
      name: "shot.png",
      mime: "image/png",
      dataUrl: "data:image/png;base64,AAA",
    }
    expect(toAttachmentView(file, safeMime).imageUrl).toBe(file.dataUrl)
  })

  test("checkpoint role maps to a return label", () => {
    expect(toCheckpointView({ id: "m1", role: "user" }).label).toContain("message")
  })

  test("source links are http(s) only", () => {
    expect(toSourceView({ title: "Docs", url: "https://example.com" }).safe).toBe(true)
    expect(toSourceView({ title: "Bad", url: "javascript:alert(1)" }).safe).toBe(false)
  })
})
