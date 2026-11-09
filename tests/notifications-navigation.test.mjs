import { afterEach, expect, test } from "bun:test"
import React, { act } from "react"
import { create } from "react-test-renderer"

import {
  NotificationsProvider,
  notificationClickSessionID,
  shouldDeferNotificationNavigation,
} from "../src/components/notifications-provider"

// `use-opencode` builds the native client at module load and needs a window
// origin. Provide the minimum for the pure snapshot helper used below.
const importWindow = globalThis.window
globalThis.window = { location: { origin: "http://ui.test" } }
const { withSessionSnapshot } = await import("../src/lib/use-opencode")
if (importWindow === undefined) delete globalThis.window
else globalThis.window = importWindow

const DEFAULT_PREFERENCES = {
  completion: true,
  needsAttention: true,
  failure: true,
  inApp: true,
  includeSessionTitle: false,
  sound: false,
}

let environment = null
let root = null

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
    root = null
  }
  environment?.restore()
  environment = null
})

function installEnvironment(search = "") {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    fetch: globalThis.fetch,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  const replacements = []
  const messageListeners = new Set()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const fakeWindow = {
    isSecureContext: false,
    location: {
      href: `http://ui.test/${search}`,
      origin: "http://ui.test",
      pathname: "/",
      search,
      hash: "",
    },
    history: {
      replaceState(_state, _title, url) {
        replacements.push(String(url))
      },
    },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  }

  globalThis.window = fakeWindow
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.navigator = {
    userAgent: "",
    platform: "",
    maxTouchPoints: 0,
    serviceWorker: {
      addEventListener(type, listener) {
        if (type === "message") messageListeners.add(listener)
      },
      removeEventListener(type, listener) {
        if (type === "message") messageListeners.delete(listener)
      },
    },
  }
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("/api/ui/notifications/state")) {
      return Response.json({
        enabled: false,
        push: false,
        preferences: DEFAULT_PREFERENCES,
        sessions: [],
      })
    }
    return Response.json({})
  }

  return {
    replacements,
    emit(message) {
      for (const listener of [...messageListeners]) listener({ data: message })
    },
    restore() {
      if (previous.window === undefined) delete globalThis.window
      else globalThis.window = previous.window
      if (previous.document === undefined) delete globalThis.document
      else globalThis.document = previous.document
      if (previous.navigator === undefined) delete globalThis.navigator
      else globalThis.navigator = previous.navigator
      if (previous.fetch === undefined) delete globalThis.fetch
      else globalThis.fetch = previous.fetch
      if (previous.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT
      else globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
    },
  }
}

function fakeNav(overrides = {}) {
  return {
    connection: "connected",
    sessionsStatus: "ready",
    sessions: [],
    activeSessionID: null,
    activeSession: null,
    selectSession() {},
    openSessionByID: async () => null,
    ...overrides,
  }
}

async function mount(nav) {
  await act(async () => {
    root = create(
      React.createElement(
        NotificationsProvider,
        { nav },
        React.createElement("div", null, "content")
      )
    )
  })
  return root
}

async function update(nav) {
  await act(async () => {
    root.update(
      React.createElement(
        NotificationsProvider,
        { nav },
        React.createElement("div", null, "content")
      )
    )
  })
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("notification click target prefers the explicit session id and trusts only same-origin URLs", () => {
  const origin = "http://ui.test"
  expect(notificationClickSessionID({ sessionID: "ses_one" }, origin)).toBe("ses_one")
  expect(notificationClickSessionID({ sessionID: "  ses_one  " }, origin)).toBe("ses_one")
  expect(notificationClickSessionID({ url: "/?session=ses_url" }, origin)).toBe("ses_url")
  expect(notificationClickSessionID({ sessionID: null, url: "http://ui.test/?session=ses_url" }, origin)).toBe("ses_url")
  expect(notificationClickSessionID({ url: "http://evil.test/?session=ses_url" }, origin)).toBe(null)
  expect(notificationClickSessionID({ url: "/?notification=1" }, origin)).toBe(null)
  expect(notificationClickSessionID(null, origin)).toBe(null)
})

test("navigation defers only while connecting or while the session list is loading", () => {
  expect(
    shouldDeferNotificationNavigation({ connection: "connecting", sessionsStatus: "ready" })
  ).toBe(true)
  expect(
    shouldDeferNotificationNavigation({ connection: "connected", sessionsStatus: "idle" })
  ).toBe(true)
  expect(
    shouldDeferNotificationNavigation({ connection: "connected", sessionsStatus: "loading" })
  ).toBe(true)
  expect(
    shouldDeferNotificationNavigation({ connection: "connected", sessionsStatus: "ready" })
  ).toBe(false)
  expect(
    shouldDeferNotificationNavigation({ connection: "connected", sessionsStatus: "error" })
  ).toBe(false)
  expect(
    shouldDeferNotificationNavigation({ connection: "offline", sessionsStatus: "idle" })
  ).toBe(false)
})

test("withSessionSnapshot inserts unloaded sessions and replaces moved rows without mutating input", () => {
  const first = { id: "ses_a", title: "A" }
  const second = { id: "ses_b", title: "B" }
  const current = [first, second]

  const unloaded = { id: "ses_c", title: "C" }
  const inserted = withSessionSnapshot(current, unloaded)
  expect(inserted.map((session) => session.id)).toEqual(["ses_c", "ses_a", "ses_b"])
  expect(current).toEqual([first, second])

  const moved = { id: "ses_b", title: "B moved", location: { directory: "/moved" } }
  const replaced = withSessionSnapshot(current, moved)
  expect(replaced.map((session) => session.id)).toEqual(["ses_a", "ses_b"])
  expect(replaced[1]).toBe(moved)
  expect(current[1]).toBe(second)

  expect(withSessionSnapshot(current, first)).toBe(current)
})

test("cold start waits for connection and list settling, then opens the pending session once", async () => {
  environment = installEnvironment("?session=ses_cold")
  const calls = []
  const openSessionByID = async (sessionID) => {
    calls.push(sessionID)
    return null
  }

  await mount(fakeNav({ connection: "connecting", sessionsStatus: "idle", openSessionByID }))
  await settle()
  expect(calls).toEqual([])

  await update(fakeNav({ connection: "connected", sessionsStatus: "loading", openSessionByID }))
  await settle()
  expect(calls).toEqual([])

  await update(fakeNav({ connection: "connected", sessionsStatus: "ready", openSessionByID }))
  await settle()
  expect(calls).toEqual(["ses_cold"])

  await update(fakeNav({ connection: "connected", sessionsStatus: "ready", openSessionByID }))
  await settle()
  expect(calls).toEqual(["ses_cold"])
  expect(environment.replacements).toHaveLength(1)
  expect(environment.replacements[0]).toBe("/")
})

test("notification taps during cold start are held until the list settles", async () => {
  environment = installEnvironment()
  const calls = []
  const openSessionByID = async (sessionID) => {
    calls.push(sessionID)
    return null
  }

  await mount(fakeNav({ connection: "connecting", sessionsStatus: "idle", openSessionByID }))
  await act(async () => {
    environment.emit({
      type: "opencode-ui:notification-click",
      sessionID: "ses_early",
      url: "/?session=ses_early",
    })
  })
  await settle()
  expect(calls).toEqual([])

  await update(fakeNav({ connection: "connected", sessionsStatus: "loading", openSessionByID }))
  await settle()
  expect(calls).toEqual([])

  await update(fakeNav({ connection: "connected", sessionsStatus: "ready", openSessionByID }))
  await settle()
  expect(calls).toEqual(["ses_early"])
})

test("repeated notification taps share one in-flight lookup and do not loop", async () => {
  environment = installEnvironment()
  const lookup = deferred()
  const calls = []
  await mount(
    fakeNav({
      openSessionByID(sessionID) {
        calls.push(sessionID)
        return lookup.promise
      },
    })
  )

  await act(async () => {
    environment.emit({
      type: "opencode-ui:notification-click",
      sessionID: "ses_tap",
      url: "/?session=ses_tap",
    })
    environment.emit({
      type: "opencode-ui:notification-click",
      sessionID: "ses_tap",
      url: "/?session=ses_tap",
    })
  })
  expect(calls).toEqual(["ses_tap"])

  await act(async () => lookup.resolve(null))
  await settle()
  expect(JSON.stringify(root.toJSON())).not.toContain("Session unavailable")

  await act(async () => {
    environment.emit({
      type: "opencode-ui:notification-click",
      sessionID: "ses_tap",
      url: "/?session=ses_tap",
    })
  })
  expect(calls).toEqual(["ses_tap", "ses_tap"])
})

test("notification clicks fall back to a same-origin URL when the message omits the id", async () => {
  environment = installEnvironment()
  const calls = []
  await mount(
    fakeNav({
      openSessionByID: async (sessionID) => {
        calls.push(sessionID)
        return null
      },
    })
  )

  await act(async () => {
    environment.emit({
      type: "opencode-ui:notification-click",
      sessionID: null,
      url: "http://evil.test/?session=ses_wrong",
    })
  })
  expect(calls).toEqual([])

  await act(async () => {
    environment.emit({
      type: "opencode-ui:notification-click",
      url: "/?session=ses_url",
    })
  })
  expect(calls).toEqual(["ses_url"])
})

test("failed notification navigation shows an honest visible failure instead of a stale selection", async () => {
  environment = installEnvironment()
  await mount(fakeNav({ openSessionByID: async () => "Session not found." }))

  await act(async () => {
    environment.emit({
      type: "opencode-ui:notification-click",
      sessionID: "ses_deleted",
    })
  })
  await settle()

  const rendered = JSON.stringify(root.toJSON())
  expect(rendered).toContain("Session unavailable")
  expect(rendered).toContain("Session not found.")
  expect(rendered).not.toContain("Open session")

  await update(fakeNav({ openSessionByID: async () => null }))
  await act(async () => {
    environment.emit({
      type: "opencode-ui:notification-click",
      sessionID: "ses_live",
    })
  })
  await settle()
  expect(JSON.stringify(root.toJSON())).not.toContain("Session unavailable")
})
