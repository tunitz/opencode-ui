import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const webPush = require("web-push") as typeof import("web-push")

export type NotificationKind = "completion" | "needs-attention" | "failure"

export type NotificationPreferences = {
  completion: boolean
  needsAttention: boolean
  failure: boolean
  inApp: boolean
  includeSessionTitle: boolean
  sound: boolean
}

export type NotificationSession = { id: string; title?: string }

export type PushSubscriptionLike = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

type StoredDevice = {
  subscription: PushSubscriptionLike | null
  preferences: NotificationPreferences
  sessions: Record<string, { title?: string; updatedAt: number }>
  updatedAt: number
}

type StoredState = {
  version: 1
  vapid: { publicKey: string; privateKey: string }
  devices: Record<string, StoredDevice>
  seen: Record<string, number>
}

type NativeEvent = {
  id?: string
  type?: string
  data?: Record<string, unknown>
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  completion: true,
  needsAttention: true,
  failure: true,
  inApp: true,
  includeSessionTitle: false,
  sound: false,
}

const MAX_BODY = 32 * 1024
const MAX_DEVICES = 100
const MAX_SESSIONS = 50
const SEEN_TTL = 7 * 24 * 60 * 60 * 1000
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000
const SEEN_MAX = 1000
const VISIBLE_TTL = 5_000
const PUSH_HOSTS = new Set([
  "web.push.apple.com",
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
])
const PUSH_HOST_SUFFIXES = [".notify.windows.com"]
const DEVICE_ID = /^[A-Za-z0-9_-]{16,128}$/
const SESSION_ID = /^[A-Za-z0-9_-]{3,160}$/

type ServiceOptions = {
  opencodeBaseUrl?: string
  authorization?: string
  stateFile?: string
  subject?: string
  startWatcher?: boolean
  sendPush?: (subscription: PushSubscriptionLike, payload: Record<string, unknown>) => Promise<void>
  fetchSessionMessages?: never
  now?: () => number
}

function preferenceValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

export function sanitizePreferences(value: unknown): NotificationPreferences {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  return {
    completion: preferenceValue(source.completion, DEFAULT_NOTIFICATION_PREFS.completion),
    needsAttention: preferenceValue(source.needsAttention, DEFAULT_NOTIFICATION_PREFS.needsAttention),
    failure: preferenceValue(source.failure, DEFAULT_NOTIFICATION_PREFS.failure),
    inApp: preferenceValue(source.inApp, DEFAULT_NOTIFICATION_PREFS.inApp),
    includeSessionTitle: preferenceValue(source.includeSessionTitle, false),
    sound: preferenceValue(source.sound, false),
  }
}

export function sanitizeSessionList(value: unknown): NotificationSession[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sessions: NotificationSession[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const id = (entry as { id?: unknown }).id
    if (typeof id !== "string" || !SESSION_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    const rawTitle = (entry as { title?: unknown }).title
    const title =
      typeof rawTitle === "string"
        ? Array.from(rawTitle)
            .filter((char) => {
              const code = char.charCodeAt(0)
              return code > 31 && code !== 127
            })
            .join("")
            .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
            .trim()
            .slice(0, 120)
        : undefined
    sessions.push({ id, ...(title ? { title } : {}) })
    if (sessions.length >= MAX_SESSIONS) break
  }
  return sessions
}

export function normalizePushEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null
    if (url.port && url.port !== "443") return null
    const host = url.hostname.toLowerCase()
    const known =
      PUSH_HOSTS.has(host) ||
      PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
    if (!known) return null
    return url.href
  } catch {
    return null
  }
}

export function sanitizePushSubscription(value: unknown): PushSubscriptionLike | null {
  if (!value || typeof value !== "object") return null
  const input = value as { endpoint?: unknown; expirationTime?: unknown; keys?: unknown }
  const endpoint = normalizePushEndpoint(input.endpoint)
  const keys = input.keys && typeof input.keys === "object" ? (input.keys as Record<string, unknown>) : null
  if (!endpoint || !keys) return null
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : ""
  const auth = typeof keys.auth === "string" ? keys.auth : ""
  if (!/^[A-Za-z0-9_-]{70,160}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,64}$/.test(auth)) return null
  const expirationTime =
    typeof input.expirationTime === "number" && Number.isFinite(input.expirationTime)
      ? input.expirationTime
      : null
  return { endpoint, expirationTime, keys: { p256dh, auth } }
}

function payloadFor(kind: NotificationKind, sessionID: string, device: StoredDevice): Record<string, unknown> {
  const sessionTitle = device.sessions[sessionID]?.title
  const visibleTitle =
    device.preferences.includeSessionTitle && sessionTitle ? sessionTitle : undefined
  const labels: Record<NotificationKind, string> = {
    completion: "Response finished",
    "needs-attention": "Needs your attention",
    failure: "Response failed",
  }
  return {
    type: kind,
    sessionID,
    title: labels[kind],
    body: visibleTitle ?? "Open OpenCode UI to view the session.",
    tag: `opencode-ui:${sessionID}:${kind}`,
    url: `/?session=${encodeURIComponent(sessionID)}`,
    sound: device.preferences.sound,
    timestamp: Date.now(),
  }
}

export function createNotificationService(options: ServiceOptions = {}) {
  const subject = options.subject ?? process.env.OPENCODE_UI_VAPID_SUBJECT ?? "https://tun-minipc.great-vernier.ts.net"
  const stateFile =
    options.stateFile ??
    process.env.OPENCODE_UI_NOTIFICATION_STATE ??
    join(homedir(), ".local", "state", "opencode-ui", "notifications", "state.json")
  const opencodeBaseUrl = options.opencodeBaseUrl ?? "http://127.0.0.1:8090"
  const authorization = options.authorization
  const now = options.now ?? Date.now
  const startWatcher = options.startWatcher ?? true
  let state: StoredState | null = null
  let loadPromise: Promise<void> | null = null
  let watcher: AbortController | null = null
  let stopped = false
  let watcherStatus: "idle" | "connecting" | "connected" | "reconnecting" | "disabled" | "stopped" = "idle"
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let snapshotRunning = false
  const visibleUntil = new Map<string, number>()
  const rate = new Map<string, { at: number; count: number }>()
  const defaultSend = async (subscription: PushSubscriptionLike, payload: Record<string, unknown>) => {
    await webPush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: { subject, publicKey: state!.vapid.publicKey, privateKey: state!.vapid.privateKey },
      TTL: 900,
      urgency: payload.type === "needs-attention" ? "high" : "normal",
      timeout: 5000,
    })
  }
  const sendPush = options.sendPush ?? defaultSend

  async function persist() {
    if (!state) return
    const directory = dirname(stateFile)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temp = `${stateFile}.${randomBytes(8).toString("hex")}.tmp`
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, stateFile)
    await chmod(stateFile, 0o600)
  }

  async function load() {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const raw = await readFile(stateFile, "utf8")
        const parsed = JSON.parse(raw) as Partial<StoredState>
        if (
          parsed.version !== 1 ||
          !parsed.vapid ||
          !parsed.vapid.publicKey ||
          !parsed.vapid.privateKey ||
          !parsed.devices ||
          typeof parsed.devices !== "object"
        ) {
          throw new Error("notification state invalid")
        }
        state = {
          version: 1,
          vapid: parsed.vapid,
          devices: parsed.devices as Record<string, StoredDevice>,
          seen: parsed.seen ?? {},
        }
        await chmod(stateFile, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error
        const keys = webPush.generateVAPIDKeys()
        state = { version: 1, vapid: keys, devices: {}, seen: {} }
        await persist()
      }
      pruneSeen()
    })()
    return loadPromise
  }

  function pruneSeen() {
    if (!state) return
    const time = now()
    const entries = Object.entries(state.seen)
      .filter(([, at]) => time - at < SEEN_TTL)
      .sort((a, b) => b[1] - a[1])
      .slice(0, SEEN_MAX)
    state.seen = Object.fromEntries(entries)
  }

  function remember(key: string): boolean {
    if (!state) return false
    pruneSeen()
    if (state.seen[key]) return false
    state.seen[key] = now()
    return true
  }

  function pruneDevices() {
    if (!state) return
    const entries = Object.entries(state.devices).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    state.devices = Object.fromEntries(entries.slice(0, MAX_DEVICES))
  }

  function setDevice(deviceID: string, update: (current: StoredDevice) => StoredDevice) {
    if (!state) throw new Error("notification service unavailable")
    const current = state.devices[deviceID] ?? {
      subscription: null,
      preferences: { ...DEFAULT_NOTIFICATION_PREFS },
      sessions: {},
      updatedAt: now(),
    }
    state.devices[deviceID] = update(current)
    pruneDevices()
    return state.devices[deviceID]
  }

  function deviceView(deviceID: string) {
    const device = state?.devices[deviceID]
    if (!device) {
      return { enabled: false, push: false, preferences: { ...DEFAULT_NOTIFICATION_PREFS }, sessions: [] }
    }
    const cutoff = now() - SESSION_TTL
    return {
      enabled: true,
      push: Boolean(device.subscription),
      preferences: device.preferences,
      sessions: Object.entries(device.sessions)
        .filter(([, value]) => value.updatedAt > cutoff)
        .map(([id, value]) => ({ id, ...(value.title ? { title: value.title } : {}) })),
    }
  }

  async function handleNativeEvent(event: NativeEvent): Promise<void> {
    if (!state || !event || typeof event.type !== "string") return
    const data = event.data ?? {}
    const eventID = typeof event.id === "string" ? event.id : null
    const formData = data.form && typeof data.form === "object" ? (data.form as { sessionID?: unknown; id?: unknown }) : null
    const sessionID =
      typeof data.sessionID === "string"
        ? data.sessionID
        : typeof formData?.sessionID === "string"
          ? formData.sessionID
          : null
    if (!sessionID || !SESSION_ID.test(sessionID)) return

    let notification: { kind: NotificationKind; dedupe: string } | null = null
    if (event.type === "session.execution.succeeded") {
      notification = { kind: "completion", dedupe: `event:${eventID ?? `${sessionID}:succeeded`}` }
    } else if (event.type === "session.execution.failed") {
      notification = { kind: "failure", dedupe: `event:${eventID ?? `${sessionID}:failed`}` }
    } else if (event.type === "permission.asked") {
      notification = { kind: "needs-attention", dedupe: `permission:${String(data.id ?? eventID ?? sessionID)}` }
    } else if (event.type === "form.created") {
      notification = { kind: "needs-attention", dedupe: `form:${String(formData?.id ?? eventID ?? sessionID)}` }
    }
    if (!notification || !remember(notification.dedupe)) return
    await persist()
    await deliver(notification.kind, sessionID)
  }

  async function deliver(kind: NotificationKind, sessionID: string) {
    if (!state) return
    const time = now()
    for (const [deviceID, device] of Object.entries(state.devices)) {
      const watchedSession = device.sessions[sessionID]
      if (!watchedSession || watchedSession.updatedAt <= time - SESSION_TTL) continue
      if (kind === "completion" && !device.preferences.completion) continue
      if (kind === "failure" && !device.preferences.failure) continue
      if (kind === "needs-attention" && !device.preferences.needsAttention) continue
      if (!device.subscription) continue
      if (device.preferences.inApp && (visibleUntil.get(deviceID) ?? 0) > time) continue
      const payload = payloadFor(kind, sessionID, device)
      const subscription = device.subscription
      try {
        await sendPush(subscription, payload)
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 429 || (typeof status === "number" && status >= 500 && status <= 599)) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1000))
          try {
            await sendPush(subscription, payload)
          } catch (retryError) {
            if ((retryError as { statusCode?: number }).statusCode === 404 || (retryError as { statusCode?: number }).statusCode === 410) {
              device.subscription = null
              device.updatedAt = time
              await persist()
            }
          }
        } else if (status === 404 || status === 410) {
          device.subscription = null
          device.updatedAt = time
          await persist()
        }
      }
    }
  }

  async function snapshotPending() {
    if (!state || !authorization || snapshotRunning) return
    snapshotRunning = true
    try {
      const headers = { authorization, accept: "application/json" }
      const [permissions, forms] = await Promise.all([
        fetch(`${opencodeBaseUrl}/api/permission/request`, { headers })
          .then((r) => (r.ok ? (r.json() as Promise<{ data?: unknown }>) : null))
          .catch(() => null),
        fetch(`${opencodeBaseUrl}/api/form`, { headers })
          .then((r) => (r.ok ? (r.json() as Promise<{ data?: unknown }>) : null))
          .catch(() => null),
      ])
      const permissionRows = Array.isArray(permissions?.data) ? permissions.data : []
      const formRows = Array.isArray(forms?.data) ? forms.data : []
      const pending = [
        ...permissionRows.map((item) => ({
          sessionID: String((item as Record<string, unknown>).sessionID ?? ""),
          key: `permission:${String((item as Record<string, unknown>).id ?? "")}`,
        })),
        ...formRows.map((item) => ({
          sessionID: String((item as Record<string, unknown>).sessionID ?? ""),
          key: `form:${String((item as Record<string, unknown>).id ?? "")}`,
        })),
      ]
      for (const item of pending) {
        if (!item.sessionID || item.key.length > 200) continue
        if (!remember(item.key)) continue
        await deliver("needs-attention", item.sessionID)
      }
      if (pending.length > 0) await persist()
    } finally {
      snapshotRunning = false
    }
  }

  function parseFrame(frame: string) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
    if (!data) return
    try {
      const event = JSON.parse(data) as NativeEvent
      void handleNativeEvent(event).catch(() => undefined)
    } catch {
      // Ignore malformed/non-JSON frames; never log payloads.
    }
  }

  async function watcherLoop() {
    if (!authorization || stopped) return
    let attempt = 0
    while (!stopped) {
      const controller = new AbortController()
      watcher = controller
      try {
        const response = await fetch(`${opencodeBaseUrl}/api/event`, {
          headers: { authorization, accept: "text/event-stream" },
          signal: controller.signal,
          cache: "no-store",
        })
        if (!response.ok || !response.body) throw new Error("SSE unavailable")
        attempt = 0
        watcherStatus = "connected"
        await snapshotPending()
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let split = buffer.indexOf("\n\n")
          while (split >= 0) {
            parseFrame(buffer.slice(0, split))
            buffer = buffer.slice(split + 2)
            split = buffer.indexOf("\n\n")
          }
        }
      } catch {
        if (!controller.signal.aborted) watcherStatus = "reconnecting"
        if (controller.signal.aborted) break
      } finally {
        if (watcher === controller) watcher = null
      }
      if (stopped) break
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
      attempt += 1
      await new Promise<void>((resolve) => {
        reconnectTimer = setTimeout(resolve, delay)
      })
      reconnectTimer = null
    }
  }

  async function start() {
    await load()
    if (startWatcher && authorization) {
      watcherStatus = "connecting"
      void watcherLoop()
    } else {
      watcherStatus = "disabled"
    }
  }

  function stop() {
    stopped = true
    watcherStatus = "stopped"
    watcher?.abort()
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function rateLimited(deviceID: string, route: string, limit: number): boolean {
    const key = `${route}:${deviceID}`
    const time = now()
    const current = rate.get(key)
    if (!current || time - current.at > 60_000) {
      rate.set(key, { at: time, count: 1 })
      return false
    }
    current.count += 1
    return current.count > limit
  }

  async function handleRequest(request: Request): Promise<Response> {
    await load()
    if (!state) return json(503, { error: "Notifications are unavailable." })
    const url = new URL(request.url)
    const path = url.pathname
    if (path === "/api/ui/notifications/public-key" && request.method === "GET") {
      return json(200, { publicKey: state.vapid.publicKey, subject })
    }
    if (path === "/api/ui/notifications/health" && request.method === "GET") {
      return json(200, { ready: true, watcher: watcherStatus, devices: Object.keys(state.devices).length })
    }
    if (path === "/api/ui/notifications/state" && request.method === "GET") {
      const deviceID = url.searchParams.get("deviceId") ?? ""
      if (!DEVICE_ID.test(deviceID)) return json(400, { error: "Invalid device." })
      return json(200, deviceView(deviceID))
    }
    if (request.method !== "POST") return json(405, { error: "Method not allowed." })
    let body: Record<string, unknown>
    try {
      const text = await request.text()
      if (new TextEncoder().encode(text).byteLength > MAX_BODY) return json(413, { error: "Request too large." })
      const parsed = JSON.parse(text) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(400, { error: "Invalid request." })
      body = parsed as Record<string, unknown>
    } catch {
      return json(400, { error: "Invalid JSON." })
    }
    const deviceID = typeof body.deviceId === "string" ? body.deviceId : ""
    if (!DEVICE_ID.test(deviceID)) return json(400, { error: "Invalid device." })
    if (path === "/api/ui/notifications/subscribe") {
      if (rateLimited(deviceID, "subscribe", 10)) return json(429, { error: "Too many requests." })
      const subscription = sanitizePushSubscription(body.subscription)
      const preferences = sanitizePreferences(body.preferences)
      const sessions = sanitizeSessionList(body.sessions)
      setDevice(deviceID, (current) => ({
        ...current,
        subscription,
        preferences,
        sessions: Object.fromEntries(sessions.map((s) => [s.id, { title: s.title, updatedAt: now() }])),
        updatedAt: now(),
      }))
      await persist()
      void snapshotPending()
      return json(200, { ...deviceView(deviceID) })
    }
    if (path === "/api/ui/notifications/preferences") {
      if (rateLimited(deviceID, "preferences", 60)) return json(429, { error: "Too many requests." })
      if (!state.devices[deviceID]) return json(404, { error: "Device is not registered." })
      const preferences = sanitizePreferences(body.preferences)
      setDevice(deviceID, (current) => ({ ...current, preferences, updatedAt: now() }))
      await persist()
      return json(200, { enabled: true, preferences })
    }
    if (path === "/api/ui/notifications/watch") {
      if (rateLimited(deviceID, "watch", 60)) return json(429, { error: "Too many requests." })
      const currentDevice = state.devices[deviceID]
      if (!currentDevice) return json(404, { error: "Device is not registered." })
      const sessions = sanitizeSessionList(body.sessions)
      const activeSessionID =
        typeof body.activeSessionID === "string" && sessions.some((session) => session.id === body.activeSessionID)
          ? body.activeSessionID
          : null
      const time = now()
      setDevice(deviceID, (current) => ({
        ...current,
        sessions: Object.fromEntries(
          sessions.map((session) => {
            const previous = current.sessions[session.id]
            const changed = !previous || previous.title !== session.title
            return [session.id, { title: session.title, updatedAt: session.id === activeSessionID || changed ? time : previous.updatedAt }]
          }),
        ),
        updatedAt: time,
      }))
      await persist()
      void snapshotPending()
      return json(200, { sessions })
    }
    if (path === "/api/ui/notifications/heartbeat") {
      if (rateLimited(deviceID, "heartbeat", 120)) return json(429, { error: "Too many requests." })
      if (!state.devices[deviceID]) return json(404, { error: "Device is not registered." })
      visibleUntil.set(deviceID, body.visible === true ? now() + VISIBLE_TTL : 0)
      return json(200, { visible: body.visible === true })
    }
    if (path === "/api/ui/notifications/unsubscribe") {
      if (rateLimited(deviceID, "unsubscribe", 20)) return json(429, { error: "Too many requests." })
      delete state.devices[deviceID]
      visibleUntil.delete(deviceID)
      await persist()
      return json(200, { enabled: false, push: false, preferences: { ...DEFAULT_NOTIFICATION_PREFS }, sessions: [] })
    }
    if (path === "/api/ui/notifications/test") {
      if (rateLimited(deviceID, "test", 5)) return json(429, { error: "Too many requests." })
      const device = state.devices[deviceID]
      if (!device) return json(404, { error: "Device is not registered." })
      if (!device.subscription) return json(200, { sent: false, inApp: true })
      try {
        await sendPush(device.subscription, {
          type: "completion",
          sessionID: "test",
          title: "Notifications are working",
          body: "Open OpenCode UI to view your sessions.",
          tag: "opencode-ui:test",
          url: "/",
          sound: device.preferences.sound,
          timestamp: now(),
        })
        return json(200, { sent: true, inApp: false })
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          device.subscription = null
          await persist()
        }
        return json(502, { error: "Push service rejected the test." })
      }
    }
    return json(404, { error: "Notification route not found." })
  }

  return {
    start,
    stop,
    handleRequest,
    handleNativeEvent,
    snapshotPending,
    stateFile,
    get ready() { return loadPromise ?? load() },
    get preferences() { return state },
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "same-origin",
    },
  })
}

function nodeHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item)
    else if (typeof value === "string") headers.set(key, value)
  }
  return headers
}

async function nodeBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > limit) throw new Error("body too large")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export function createNotificationMiddleware(service: ReturnType<typeof createNotificationService>) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = new URL(request.url ?? "/", "http://local").pathname
    if (pathname !== "/api/ui/notifications" && !pathname.startsWith("/api/ui/notifications/")) {
      next()
      return
    }
    void (async () => {
      try {
        const body = request.method === "POST" ? await nodeBody(request, MAX_BODY) : undefined
        const webRequest = new Request(`http://${request.headers.host ?? "127.0.0.1"}${request.url ?? "/"}`, {
          method: request.method,
          headers: nodeHeaders(request),
          ...(body && body.byteLength > 0 ? { body, duplex: "half" as const } : {}),
        })
        const webResponse = await service.handleRequest(webRequest)
        response.statusCode = webResponse.status
        webResponse.headers.forEach((value, key) => response.setHeader(key, value))
        response.end(await webResponse.text())
      } catch {
        if (!response.headersSent) {
          response.statusCode = 500
          response.setHeader("content-type", "application/json; charset=utf-8")
          response.setHeader("cache-control", "private, no-store")
        }
        response.end(JSON.stringify({ error: "Notification request failed." }))
      }
    })()
  }
}
