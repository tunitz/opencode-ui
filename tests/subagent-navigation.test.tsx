import { afterAll, describe, expect, mock, test } from "bun:test"
import { act, cloneElement, createElement, type ElementType, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { create, type ReactTestRenderer } from "react-test-renderer"
import type { SessionInfo } from "../src/lib/opencode"
import type { OpenCodeController, SessionListChange } from "../src/lib/use-opencode"

const MenuRoot = "menu-root" as unknown as ElementType
const MenuContent = "menu-content" as unknown as ElementType
const MenuItem = "menu-item" as unknown as ElementType

type Page = { data: SessionInfo[]; cursor?: { next?: string } }
let list: (input: { parentID: string; limit: number }) => Promise<Page> = async () => ({ data: [] })
mock.module("@/components/ui/button", () => ({ Button: ({ children, ...props }: { children?: ReactNode }) => createElement("button", props, children) }))
mock.module("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children, ...props }: { children?: ReactNode }) => createElement("menu-root", props, children),
  DropdownMenuTrigger: ({ children, render }: { children: ReactNode; render: ReactElement<{ children?: ReactNode }> }) => cloneElement(render, {}, children),
  DropdownMenuContent: ({ children, ...props }: { children?: ReactNode }) => createElement("menu-content", props, children),
  DropdownMenuItem: ({ children, ...props }: { children?: ReactNode }) => createElement("menu-item", props, children),
}))
const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const previousWindow = globalThis.window
globalThis.window = { location: { origin: "http://localhost" } } as Window & typeof globalThis
afterAll(() => {
  mock.restore()
  if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  else (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window")
  else globalThis.window = previousWindow
})
const actualOpenCode = await import("../src/lib/opencode")
mock.module("@/lib/opencode", () => ({
  ...actualOpenCode,
  openCode: { session: { list: (input: { parentID: string; limit: number }) => list(input) } },
}))
const { loadDirectSubagents, SubagentNavigation } = await import("../src/components/subagent-navigation")

const session = (id: string, parentID?: string, title?: string, agent?: string) => ({ id, parentID, title, agent, time: { created: 1, updated: 1 } }) as SessionInfo
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const text = (view: ReactTestRenderer) => JSON.stringify(view.toJSON())

describe("subagent header navigation", () => {
  test("requests a bounded direct-child page and filters unrelated sessions", async () => {
    let input: unknown
    const result = await loadDirectSubagents("parent", (async (params: unknown) => {
      input = params
      return { data: [session("child", "parent"), session("grandchild", "child"), session("other")], cursor: { next: "more" } }
    }) as Parameters<typeof loadDirectSubagents>[1])
    expect(input).toEqual({ parentID: "parent", limit: 50 })
    expect(result.children.map((child: SessionInfo) => child.id)).toEqual(["child"])
    expect(result.truncated).toBe(true)
  })

  test("renders labelled header controls and mirrors the parent arrow in RTL", () => {
    const nav = { activeSession: session("child", "parent"), sessions: [], runningSessionIDs: {} } as unknown as OpenCodeController
    const html = renderToStaticMarkup(createElement(SubagentNavigation, { nav, title: "A task" }))
    expect(html).toContain('aria-label="Return to parent session"')
    expect(html).toContain('aria-label="A task. Show subagents"')
    expect(html).toMatch(/<h1[^>]*>.*<button[^>]*aria-label="A task\. Show subagents"[^>]*>.*A task/)
    expect(html).toContain("rtl:rotate-180")
    expect(html).toContain("size-11")
    const root = renderToStaticMarkup(createElement(SubagentNavigation, { nav: { ...nav, activeSession: session("root") }, title: "Root" }))
    expect(root).not.toContain('aria-label="Return to parent session"')
  })

  test("shows the project label above the session title", () => {
    const nav = { activeSession: session("root"), sessions: [], runningSessionIDs: {} } as unknown as OpenCodeController
    const html = renderToStaticMarkup(createElement(SubagentNavigation, { nav, title: "A task", projectLabel: "opencode-ui" }))
    expect(html).toContain("opencode-ui")
    expect(html).toMatch(/A task[\s\S]*opencode-ui/)
    const without = renderToStaticMarkup(createElement(SubagentNavigation, { nav, title: "A task" }))
    expect(without).not.toContain("opencode-ui")
  })

  test("refreshes uncached children on events, rejects stale responses and opens by ID", async () => {
    const requests: ReturnType<typeof deferred<Page>>[] = []
    list = () => { const request = deferred<Page>(); requests.push(request); return request.promise }
    let notify: ((change: SessionListChange) => void) | undefined
    const opened: string[] = []
    const nav = {
      activeSession: session("parent"), sessions: [], runningSessionIDs: { child: true },
      subscribeSessionListChanges: (listener: (change: SessionListChange) => void) => { notify = listener; return () => { notify = undefined } },
      openSessionByID: async (id: string) => { opened.push(id); return null },
    } as unknown as OpenCodeController
    let view!: ReactTestRenderer
    await act(async () => { view = create(createElement(SubagentNavigation, { nav, title: "Parent" })) })
    expect(view.root.findByType(MenuContent).props.align).toBe("center")
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(true) })
    expect(requests).toHaveLength(1)
    expect(text(view)).toContain("rotate-180")
    expect(text(view)).toContain("Loading subagents")
    await act(async () => { requests[0].resolve({ data: [session("child", "parent", "Old title", "explore")] }) })
    expect(text(view)).toContain("Old title")
    expect(text(view)).toContain("explore · Running")
    await act(async () => { notify!({ sessionID: "child" }) })
    expect(requests).toHaveLength(2)
    await act(async () => { notify!({ sessionID: "child" }); notify!({ sessionID: "child" }) })
    expect(requests).toHaveLength(2)
    await act(async () => { requests[1].resolve({ data: [session("child", "parent", "Intermediate title")] }) })
    expect(requests).toHaveLength(3)
    expect(text(view)).toContain("Refreshing subagents")
    await act(async () => { requests[2].resolve({ data: [session("child", "parent", "Fresh title", "worker")] }) })
    expect(text(view)).toContain("Fresh title")
    expect(text(view)).not.toContain("Intermediate title")
    await act(async () => { view.root.findByType(MenuItem).props.onClick() })
    expect(opened).toEqual(["child"])
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(false) })
    expect(notify).toBeUndefined()
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(true) })
    expect(requests).toHaveLength(4)
    await act(async () => { view.unmount() })
  })

  test("shows fetch and child navigation failures and retries", async () => {
    let calls = 0
    list = async () => { if (++calls === 1) throw new Error("offline"); return { data: [session("child", "parent", "Task")] } }
    const nav = { activeSession: session("parent"), sessions: [], runningSessionIDs: {}, subscribeSessionListChanges: () => () => {}, openSessionByID: async () => "unavailable" } as unknown as OpenCodeController
    let view!: ReactTestRenderer
    await act(async () => { view = create(createElement(SubagentNavigation, { nav, title: "Parent" })) })
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(true) })
    expect(text(view)).toContain("Unable to load subagents")
    await act(async () => { view.root.findByType(MenuItem).props.onClick({ preventDefault() {} }) })
    expect(text(view)).toContain("Task")
    await act(async () => { view.root.findByType(MenuItem).props.onClick() })
    expect(text(view)).toContain("Subagent session is unavailable or changed")
    await act(async () => { view.unmount() })
  })
  test("coalesces a child creation during a request and ignores results after closing", async () => {
    const requests: ReturnType<typeof deferred<Page>>[] = []
    list = () => { const request = deferred<Page>(); requests.push(request); return request.promise }
    let notify: ((change: SessionListChange) => void) | undefined
    const nav = { activeSession: session("parent"), sessions: [], runningSessionIDs: {}, subscribeSessionListChanges: (listener: (change: SessionListChange) => void) => { notify = listener; return () => { notify = undefined } } } as unknown as OpenCodeController
    let view!: ReactTestRenderer
    await act(async () => { view = create(createElement(SubagentNavigation, { nav, title: "Parent" })) })
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(true) })
    await act(async () => { notify!({ sessionID: "new", parentID: "parent" }) })
    expect(requests).toHaveLength(1)
    await act(async () => { requests[0].resolve({ data: [] }) })
    expect(requests).toHaveLength(2)
    expect(text(view)).toContain("Refreshing subagents")
    await act(async () => { requests[1].resolve({ data: [session("new", "parent", "New child")] }) })
    expect(text(view)).toContain("New child")
    await act(async () => { notify!({ sessionID: null }) })
    expect(requests).toHaveLength(3)
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(false) })
    await act(async () => { requests[2].resolve({ data: [session("new", "parent", "Closed result")] }) })
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(true) })
    expect(text(view)).not.toContain("Closed result")
    await act(async () => { requests[3].resolve({ data: [] }) })
    expect(text(view)).toContain("No direct subagents found")
    await act(async () => { view.unmount() })
  })

  test("unrelated event bursts do not starve an in-flight page or cause refetches", async () => {
    const requests: ReturnType<typeof deferred<Page>>[] = []
    list = () => { const request = deferred<Page>(); requests.push(request); return request.promise }
    let notify!: (change: SessionListChange) => void
    const nav = { activeSession: session("parent"), sessions: [], runningSessionIDs: {}, subscribeSessionListChanges: (listener: typeof notify) => { notify = listener; return () => {} } } as unknown as OpenCodeController
    let view!: ReactTestRenderer
    await act(async () => { view = create(createElement(SubagentNavigation, { nav, title: "Parent" })) })
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(true) })
    for (let i = 0; i < 20; i++) {
      await act(async () => { notify({ sessionID: `unrelated-${i}` }); notify({ sessionID: `new-${i}`, parentID: "other-parent" }) })
    }
    expect(requests).toHaveLength(1)
    await act(async () => { requests[0].resolve({ data: [session("child", "parent", "Loaded promptly")] }) })
    expect(requests).toHaveLength(1)
    expect(text(view)).toContain("Loaded promptly")
    expect(text(view)).not.toContain("Loading subagents")
    await act(async () => { view.unmount() })
  })

  test("an uncached child changed during discovery causes one follow-up", async () => {
    const requests: ReturnType<typeof deferred<Page>>[] = []
    list = () => { const request = deferred<Page>(); requests.push(request); return request.promise }
    let notify!: (change: SessionListChange) => void
    const nav = { activeSession: session("parent"), sessions: [], runningSessionIDs: {}, subscribeSessionListChanges: (listener: typeof notify) => { notify = listener; return () => {} } } as unknown as OpenCodeController
    let view!: ReactTestRenderer
    await act(async () => { view = create(createElement(SubagentNavigation, { nav, title: "Parent" })) })
    await act(async () => { view.root.findByType(MenuRoot).props.onOpenChange(true) })
    await act(async () => { notify({ sessionID: "child" }); notify({ sessionID: "child" }); notify({ sessionID: "other" }) })
    expect(requests).toHaveLength(1)
    await act(async () => { requests[0].resolve({ data: [session("child", "parent", "Possibly old")] }) })
    expect(requests).toHaveLength(2)
    expect(text(view)).toContain("Refreshing subagents")
    await act(async () => { requests[1].resolve({ data: [session("child", "parent", "Current")] }) })
    expect(text(view)).toContain("Current")
    expect(requests).toHaveLength(2)
    await act(async () => { view.unmount() })
  })

})
