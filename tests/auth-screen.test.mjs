import { afterEach, beforeEach, expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

import { AuthScreen } from "../src/components/auth-screen"

const originalFetch = globalThis.fetch
let calls
let respond

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

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
    return respond(call)
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

async function mount(props) {
  let root
  await act(async () => {
    root = create(React.createElement(AuthScreen, props))
  })
  return root
}

const passwordInput = (root) => root.root.findByProps({ id: "auth-password" })
const confirmInput = (root) => root.root.findByProps({ id: "auth-confirm" })
const submitForm = async (root) => {
  const form = root.root.findByType("form")
  await act(async () => {
    await form.props.onSubmit({ preventDefault() {} })
  })
}
const alertText = (root) => {
  const alerts = root.root.findAllByProps({ role: "alert" })
  return alerts.map((alert) => text(alert)).join(" ")
}

test("setup mode renders both password fields and the one-line purpose hint", async () => {
  let root
  try {
    root = await mount({ mode: "setup" })
    expect(JSON.stringify(root.toJSON())).toContain("Set a password")
    expect(JSON.stringify(root.toJSON())).toContain(
      "This password protects the UI on this network."
    )
    expect(passwordInput(root).props.type).toBe("password")
    expect(passwordInput(root).props.autoComplete).toBe("new-password")
    expect(confirmInput(root).props.autoComplete).toBe("new-password")
    expect(JSON.stringify(root.toJSON())).toContain("At least 8 characters.")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("login mode renders one current-password field", async () => {
  let root
  try {
    root = await mount({ mode: "login" })
    expect(JSON.stringify(root.toJSON())).toContain("Sign in")
    expect(passwordInput(root).props.autoComplete).toBe("current-password")
    expect(root.root.findAllByProps({ id: "auth-confirm" })).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("setup refuses mismatched passwords without calling the server", async () => {
  let root
  try {
    root = await mount({ mode: "setup" })
    await act(async () => {
      passwordInput(root).props.onChange({ target: { value: "first horse" } })
      confirmInput(root).props.onChange({ target: { value: "second horse" } })
    })
    await submitForm(root)
    expect(alertText(root)).toContain("Passwords do not match.")
    expect(calls).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("short passwords are rejected client-side", async () => {
  let root
  try {
    root = await mount({ mode: "setup" })
    await act(async () => {
      passwordInput(root).props.onChange({ target: { value: "short" } })
      confirmInput(root).props.onChange({ target: { value: "short" } })
    })
    await submitForm(root)
    expect(alertText(root)).toContain("Use at least 8 characters.")
    expect(calls).toHaveLength(0)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("setup posts the password, shows busy text and reports success", async () => {
  let resolveSetup
  let root
  try {
    respond = () =>
      new Promise((resolve) => {
        resolveSetup = () => resolve(json({ ok: true }))
      })
    const onSuccess = []
    root = await mount({ mode: "setup", onSuccess: () => onSuccess.push(true) })
    await act(async () => {
      passwordInput(root).props.onChange({ target: { value: "correct horse" } })
      confirmInput(root).props.onChange({ target: { value: "correct horse" } })
    })
    const form = root.root.findByType("form")
    let submitPromise
    await act(async () => {
      submitPromise = form.props.onSubmit({ preventDefault() {} })
      await Promise.resolve()
    })
    expect(JSON.stringify(root.toJSON())).toContain("Setting up…")
    const button = root.root.findAllByType("button")[0]
    expect(button.props.disabled).toBe(true)
    expect(calls[0]).toMatchObject({
      url: "/api/ui/auth/setup",
      method: "POST",
      body: { password: "correct horse" },
    })

    await act(async () => {
      resolveSetup()
      await submitPromise
    })
    expect(onSuccess).toHaveLength(1)
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("login surfaces the server error and re-enables the form", async () => {
  let root
  try {
    respond = () => json({ error: { code: "invalid_credentials" } }, 401)
    root = await mount({ mode: "login" })
    await act(async () => {
      passwordInput(root).props.onChange({ target: { value: "wrong horse" } })
    })
    await submitForm(root)
    expect(alertText(root)).toContain("That password is incorrect.")
    const button = root.root.findAllByType("button")[0]
    expect(button.props.disabled).toBe(false)
    expect(JSON.stringify(root.toJSON())).not.toContain("Signing in…")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})

test("login shows the throttling message from a 429", async () => {
  let root
  try {
    respond = () => json({ error: { code: "too_many_attempts" } }, 429)
    root = await mount({ mode: "login" })
    await act(async () => {
      passwordInput(root).props.onChange({ target: { value: "wrong horse" } })
    })
    await submitForm(root)
    expect(alertText(root)).toContain("Too many attempts. Try again in a minute.")
  } finally {
    if (root) await act(async () => root.unmount())
  }
})
