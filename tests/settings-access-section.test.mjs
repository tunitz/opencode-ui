import { afterAll, afterEach, beforeEach, expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

const originalWindow = globalThis.window
const originalFetch = globalThis.fetch

// Product modules reach `window` at import time through the UI primitives.
globalThis.window = {
  location: { origin: "http://localhost" },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
}

const { SettingsAccessSection } = await import(
  "../src/components/settings-access-section"
)
const { AlertDialog, AlertDialogAction, AlertDialogContent } = await import(
  "../src/components/ui/alert-dialog"
)

afterAll(() => {
  globalThis.window = originalWindow
})

let calls
let handle
let statusState

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const configuredStatus = (extra = {}) => ({
  configured: true,
  required: false,
  authenticated: true,
  ...extra,
})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls = []
  statusState = configuredStatus()
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method ?? "GET",
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    }
    calls.push(call)
    return handle(call)
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

const text = (node) =>
  (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("")

const collectText = (node) => {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(collectText).join("")
  if (React.isValidElement(node)) return collectText(node.props.children)
  return ""
}

const findChildElement = (node, predicate) => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findChildElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (!React.isValidElement(node)) return null
  if (predicate(node)) return node
  return findChildElement(node.props.children, predicate)
}

const rendered = (root) => JSON.stringify(root.toJSON())
const buttons = (root) => root.root.findAllByType("button")
const button = (root, label) =>
  buttons(root).find((node) => text(node).trim() === label)
const alertText = (root) =>
  root.root
    .findAllByProps({ role: "alert" })
    .map((node) => text(node))
    .join(" ")

async function flush() {
  for (let index = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function mount() {
  let root
  await act(async () => {
    root = create(React.createElement(SettingsAccessSection))
  })
  await flush()
  return root
}

async function changeField(root, id, value) {
  await act(async () => {
    root.root.findByProps({ id }).props.onChange({ target: { value } })
  })
}

async function submit(root) {
  const form = root.root.findByType("form")
  await act(async () => {
    await form.props.onSubmit({ preventDefault() {} })
  })
  await flush()
}

test("shows the configured state and change form, without removal on a required bind", async () => {
  statusState = configuredStatus({ required: true })
  handle = (call) =>
    call.url === "/api/ui/auth/status" ? json(statusState) : json({ ok: true })
  let root
  try {
    root = await mount()
    const tree = rendered(root)
    expect(tree).toContain("Password set")
    expect(tree).toContain("Required on this network")
    expect(tree).toContain("Current password")
    expect(tree).toContain("New password")
    expect(tree).toContain("Confirm new password")
    expect(button(root, "Update password")).toBeDefined()
    expect(button(root, "Remove password")).toBeUndefined()
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("offers removal only when the password is not required", async () => {
  handle = (call) =>
    call.url === "/api/ui/auth/status" ? json(statusState) : json({ ok: true })
  let root
  try {
    root = await mount()
    expect(rendered(root)).not.toContain("Required on this network")
    expect(button(root, "Remove password")).toBeDefined()
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("changing the password sends current and next, then reports success", async () => {
  handle = (call) =>
    call.url === "/api/ui/auth/status" ? json(statusState) : json({ ok: true })
  let root
  try {
    root = await mount()
    await changeField(root, "access-current", "old password")
    await changeField(root, "access-new", "new password")
    await changeField(root, "access-confirm", "new password")
    await submit(root)

    const change = calls.find((call) => call.url === "/api/ui/auth/password")
    expect(change).toMatchObject({
      method: "PUT",
      body: { current: "old password", next: "new password" },
    })
    expect(rendered(root)).toContain("Password updated.")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("a wrong current password is surfaced inline and keeps the form", async () => {
  handle = (call) =>
    call.url === "/api/ui/auth/status"
      ? json(statusState)
      : json({ error: { code: "invalid_credentials" } }, 401)
  let root
  try {
    root = await mount()
    await changeField(root, "access-current", "wrong password")
    await changeField(root, "access-new", "new password")
    await changeField(root, "access-confirm", "new password")
    await submit(root)
    expect(alertText(root)).toContain("That password is incorrect.")
    expect(root.root.findByProps({ id: "access-current" }).props.value).toBe(
      "wrong password"
    )
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("removal is confirmed in an alert dialog and sends an empty next password", async () => {
  handle = (call) => {
    if (call.url === "/api/ui/auth/status") return json(statusState)
    statusState = { ...statusState, configured: false }
    return json({ ok: true })
  }
  let root
  try {
    root = await mount()
    await act(async () => {
      button(root, "Remove password").props.onClick()
    })
    const dialog = root.root.findAllByType(AlertDialog)[0]
    expect(dialog.props.open).toBe(true)

    const content = () => root.root.findAllByType(AlertDialogContent)[0]
    const input = findChildElement(
      content().props.children,
      (element) => element.props?.id === "access-remove-current"
    )
    expect(input).toBeTruthy()
    await act(async () => {
      input.props.onChange({ target: { value: "current password" } })
    })

    const action = findChildElement(
      content().props.children,
      (element) => element.type === AlertDialogAction
    )
    await act(async () => {
      action.props.onClick({ preventDefault() {} })
    })
    await flush()

    const removal = calls.find((call) => call.url === "/api/ui/auth/password")
    expect(removal).toMatchObject({
      method: "PUT",
      body: { current: "current password", next: "" },
    })
    const tree = rendered(root)
    expect(tree).toContain("Password removed.")
    expect(tree).toContain("Not set")
    expect(tree).toContain("Set password")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("a required-bind refusal to remove is surfaced inside the dialog", async () => {
  handle = (call) =>
    call.url === "/api/ui/auth/status"
      ? json(statusState)
      : json({ error: { code: "password_required" } }, 409)
  let root
  try {
    root = await mount()
    await act(async () => {
      button(root, "Remove password").props.onClick()
    })
    const content = () => root.root.findAllByType(AlertDialogContent)[0]
    const input = findChildElement(
      content().props.children,
      (element) => element.props?.id === "access-remove-current"
    )
    await act(async () => {
      input.props.onChange({ target: { value: "current password" } })
    })
    const action = findChildElement(
      content().props.children,
      (element) => element.type === AlertDialogAction
    )
    await act(async () => {
      action.props.onClick({ preventDefault() {} })
    })
    await flush()
    const alert = findChildElement(
      content().props.children,
      (element) => element.props?.role === "alert"
    )
    expect(collectText(alert)).toContain(
      "A password is required on this network."
    )
    expect(root.root.findAllByType(AlertDialog)[0].props.open).toBe(true)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("sets a first password when none exists, and explains it is optional", async () => {
  statusState = {
    configured: false,
    required: false,
    authenticated: true,
  }
  handle = (call) => {
    if (call.url === "/api/ui/auth/status") return json(statusState)
    statusState = { ...statusState, configured: true }
    return json({ ok: true })
  }
  let root
  try {
    root = await mount()
    expect(rendered(root)).toContain("Not set")
    expect(rendered(root)).toContain("A password is optional on this network.")
    expect(root.root.findAllByProps({ id: "access-current" })).toHaveLength(0)

    await changeField(root, "access-new", "correct horse")
    await changeField(root, "access-confirm", "correct horse")
    await submit(root)

    const setup = calls.find((call) => call.url === "/api/ui/auth/setup")
    expect(setup).toMatchObject({
      method: "POST",
      body: { password: "correct horse" },
    })
    expect(rendered(root)).toContain("Password set.")
    expect(rendered(root)).toContain("Update password")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("a status load failure offers Retry and recovers", async () => {
  let fail = true
  handle = () =>
    fail ? Promise.reject(new TypeError("offline")) : json(statusState)
  let root
  try {
    root = await mount()
    expect(alertText(root)).toContain("The server could not be reached.")
    fail = false
    await act(async () => {
      button(root, "Retry").props.onClick()
    })
    await flush()
    expect(rendered(root)).toContain("Password set")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})
