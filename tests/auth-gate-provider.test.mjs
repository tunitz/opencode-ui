import { afterEach, beforeEach, expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

import {
  AuthGateProvider,
  useAuthGate,
} from "../src/components/auth-context"

const originalFetch = globalThis.fetch
let calls
let handle

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const authenticated = {
  configured: true,
  required: true,
  authenticated: true,
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls = []
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

function EngineApp() {
  return React.createElement("div", { id: "engine-app" }, "Engine app")
}

function Harness() {
  const auth = useAuthGate()
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "button",
      { type: "button", id: "signal-login", onClick: () => auth.signalUnauthorized() },
      "signal login"
    ),
    React.createElement(
      "button",
      {
        type: "button",
        id: "signal-setup",
        onClick: () => auth.signalUnauthorized("setup_required"),
      },
      "signal setup"
    ),
    React.createElement(
      "button",
      { type: "button", id: "sign-out", onClick: () => void auth.signOut() },
      "sign out"
    ),
    React.createElement(
      "span",
      { id: "gate-status" },
      auth.status ? JSON.stringify(auth.status) : "none"
    ),
    React.createElement("span", { id: "gate-error" }, auth.loadError ?? "")
  )
}

function tree() {
  return React.createElement(
    AuthGateProvider,
    null,
    React.createElement(EngineApp),
    React.createElement(Harness)
  )
}

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
    root = create(tree())
  })
  return root
}

const rendered = (root) => JSON.stringify(root.toJSON())
const hasApp = (root) => root.root.findAllByProps({ id: "engine-app" }).length > 0
const inputs = (root, id) =>
  root.root.findAll((node) => node.type === "input" && node.props.id === id)

async function click(root, id) {
  await act(async () => {
    await root.root.findByProps({ id }).props.onClick()
  })
}

test("shows an honest loading state until the status resolves", async () => {
  let resolve
  handle = () =>
    new Promise((next) => {
      resolve = (response) => next(response)
    })
  let root
  try {
    root = await mount()
    expect(rendered(root)).toContain("Starting opencode-ui")
    expect(hasApp(root)).toBe(false)
    expect(root.root.findAllByProps({ id: "engine-app" })).toHaveLength(0)

    await act(async () => {
      resolve(json(authenticated))
      await Promise.resolve()
    })
    expect(hasApp(root)).toBe(true)
    expect(rendered(root)).not.toContain("Starting opencode-ui")
    expect(root.root.findByProps({ id: "gate-status" }).children).toEqual([
      JSON.stringify(authenticated),
    ])
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("surfaces a status load failure with Retry, then boots the app", async () => {
  let fail = true
  handle = () => {
    if (fail) throw new TypeError("offline")
    return json(authenticated)
  }
  let root
  try {
    root = await mount()
    expect(hasApp(root)).toBe(false)
    expect(rendered(root)).toContain("The server could not be reached.")

    fail = false
    const retry = root.root.findAllByType("button").find((button) =>
      text(button).includes("Retry")
    )
    await act(async () => {
      retry.props.onClick()
    })
    await flush()
    expect(hasApp(root)).toBe(true)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("renders setup mode when no password is configured", async () => {
  handle = () =>
    json({ configured: false, required: true, authenticated: false })
  let root
  try {
    root = await mount()
    expect(rendered(root)).toContain("Set a password")
    expect(hasApp(root)).toBe(false)
    expect(inputs(root, "auth-confirm")).toHaveLength(1)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("renders login mode when a password is configured", async () => {
  handle = () =>
    json({ configured: true, required: true, authenticated: false })
  let root
  try {
    root = await mount()
    expect(rendered(root)).toContain("Sign in")
    expect(hasApp(root)).toBe(false)
    expect(inputs(root, "auth-confirm")).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("renders children while authenticated", async () => {
  handle = () => json(authenticated)
  let root
  try {
    root = await mount()
    expect(hasApp(root)).toBe(true)
    expect(rendered(root)).not.toContain("Sign in")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("signalUnauthorized swaps to the login screen without a reload", async () => {
  handle = () => json(authenticated)
  let root
  try {
    root = await mount()
    expect(hasApp(root)).toBe(true)

    await click(root, "signal-login")
    expect(rendered(root)).toContain("Sign in")
    expect(hasApp(root)).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("signalUnauthorized with setup_required shows the setup form", async () => {
  handle = () => json(authenticated)
  let root
  try {
    root = await mount()
    expect(hasApp(root)).toBe(true)

    await click(root, "signal-setup")
    expect(rendered(root)).toContain("Set a password")
    expect(hasApp(root)).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("signOut calls logout and shows the login screen", async () => {
  handle = (call) =>
    call.url === "/api/ui/auth/logout"
      ? new Response(null, { status: 204 })
      : json(authenticated)
  let root
  try {
    root = await mount()
    await click(root, "sign-out")
    await flush()
    expect(calls.some((call) => call.url === "/api/ui/auth/logout")).toBe(true)
    expect(rendered(root)).toContain("Sign in")
    expect(hasApp(root)).toBe(false)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("a successful sign-in re-fetches the status and mounts the app", async () => {
  let statusReads = 0
  handle = (call) => {
    if (call.url === "/api/ui/auth/status") {
      statusReads += 1
      return json(
        statusReads === 1
          ? { configured: true, required: true, authenticated: false }
          : authenticated
      )
    }
    return json({ ok: true })
  }
  let root
  try {
    root = await mount()
    expect(rendered(root)).toContain("Sign in")
    await act(async () => {
      inputs(root, "auth-password")[0].props.onChange({
        target: { value: "correct horse" },
        currentTarget: { value: "correct horse" },
      })
    })
    const form = root.root.findByType("form")
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} })
    })
    await flush()
    expect(
      calls.some(
        (call) =>
          call.url === "/api/ui/auth/login" &&
          call.body?.password === "correct horse"
      )
    ).toBe(true)
    expect(statusReads).toBeGreaterThanOrEqual(2)
    expect(hasApp(root)).toBe(true)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})
