import { expect, mock, test } from "bun:test"
import React, { act, createContext, useContext, useState } from "react"
import { create } from "react-test-renderer"

const Context = createContext(null)
function Root({ children, open: controlled, onOpenChange }) {
  const [local, setLocal] = useState(false)
  const open = controlled ?? local
  return React.createElement(Context.Provider, { value: { open, setOpen: onOpenChange ?? setLocal } }, children)
}
function Trigger({ children, ...props }) {
  const { open, setOpen } = useContext(Context)
  return React.createElement("button", { ...props, "aria-expanded": open, onClick: () => setOpen(!open) }, children)
}
function Content({ children }) {
  return useContext(Context).open ? React.createElement("div", null, children) : null
}
mock.module("../src/components/ui/collapsible", () => ({ Collapsible: Root, CollapsibleTrigger: Trigger, CollapsibleContent: Content }))
mock.module("../src/components/ui/trace", () => ({
  Trace: ({ children }) => React.createElement("div", null, children),
  TraceCollapsible: Root, TraceCollapsibleTrigger: Trigger, TraceCollapsibleContent: Content,
  TraceLine: ({ children }) => React.createElement("span", null, children),
  TraceIcon: ({ children }) => React.createElement("span", null, children),
  TraceTitle: ({ children }) => React.createElement("span", null, children),
  TraceDescription: ({ children }) => React.createElement("span", null, children),
}))
const { ToolTrace } = await import("../src/components/conversation")

test("a collapsed single call identifies what is running", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const tools = [{ id: "1", name: "skill", status: "running", input: { id: "frontend-design" }, files: [] }]
    await act(async () => { root = create(React.createElement(ToolTrace, { tools, open: false, onOpenChange() {} })) })
    expect(JSON.stringify(root.toJSON())).toContain("frontend-design")
  } finally {
    if (root) await act(async () => root.unmount())
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})

test("individual calls expand independently with escaped input and output", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const tools = [
      { id: "1", name: "shell", status: "completed", input: { command: "echo hi" }, output: "<script>hi</script>", files: [] },
      { id: "2", name: "skill", status: "running", input: { name: "frontend-design" }, files: [] },
    ]
    await act(async () => { root = create(React.createElement(ToolTrace, { tools, open: true, onOpenChange() {} })) })
    let text = JSON.stringify(root.toJSON())
    expect(text).toContain("echo hi")
    expect(text).toContain("frontend-design")
    expect(text).not.toContain("<script>")
    const rows = root.root.findAllByType("button")
    expect(rows).toHaveLength(3)
    await act(async () => rows[1].props.onClick())
    text = JSON.stringify(root.toJSON())
    expect(text).toContain("<script>hi</script>")
    expect(root.root.findAllByType("pre")).toHaveLength(2)
    expect(rows[2].props["aria-expanded"]).toBe(false)
    await act(async () => rows[2].props.onClick())
    expect(root.root.findAllByType("pre")).toHaveLength(3)
    await act(async () => rows[1].props.onClick())
    expect(root.root.findAllByType("pre")).toHaveLength(1)
  } finally {
    if (root) await act(async () => root.unmount())
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
