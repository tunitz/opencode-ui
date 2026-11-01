import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { BellIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationDeviceID,
  notificationFeatureState,
  readNotificationPublicKey,
  readNotificationState,
  sendNotificationHeartbeat,
  subscribeNotificationDevice,
  testNotificationDevice,
  unsubscribeNotificationDevice,
  urlBase64ToUint8Array,
  writeNotificationPreferences,
  writeNotificationWatch,
  type NotificationKind,
  type NotificationPreferences,
  type NotificationSession,
} from "@/lib/notifications"
import type { OpenCodeController } from "@/lib/use-opencode"

type Notice = { kind: NotificationKind; sessionID: string; text: string; test?: boolean }

type NotificationsContextValue = {
  support: ReturnType<typeof notificationFeatureState>
  permission: NotificationPermission | "unsupported"
  ready: boolean
  enabled: boolean
  pushEnabled: boolean
  preferences: NotificationPreferences
  sessions: NotificationSession[]
  busy: boolean
  error: string | null
  enablePush: () => Promise<void>
  enableInApp: () => Promise<void>
  disable: () => Promise<void>
  updatePreferences: (patch: Partial<NotificationPreferences>) => Promise<void>
  clearSessions: () => Promise<void>
  sendTest: () => Promise<void>
  refresh: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

function activeSessionList(
  activeSessionID: string | null,
  title: string | null | undefined,
  current: NotificationSession[]
): NotificationSession[] {
  if (!activeSessionID) return current
  const existing = current.find((session) => session.id === activeSessionID)
  const next = current.filter((session) => session.id !== activeSessionID)
  next.push({ id: activeSessionID, ...(title?.trim() ? { title: title.trim().slice(0, 120) } : existing?.title ? { title: existing.title } : {}) })
  return next.slice(-50)
}

function eventSessionID(data: Record<string, unknown>): string | null {
  if (typeof data.sessionID === "string") return data.sessionID
  const form = data.form && typeof data.form === "object" ? (data.form as { sessionID?: unknown }) : null
  return typeof form?.sessionID === "string" ? form.sessionID : null
}

function notificationFromEvent(event: { type?: string; data?: Record<string, unknown> }, prefs: NotificationPreferences): { kind: NotificationKind; sessionID: string; key: string } | null {
  if (!event.type || !event.data) return null
  const sessionID = eventSessionID(event.data)
  if (!sessionID) return null
  if (event.type === "session.execution.succeeded" && prefs.completion) {
    return { kind: "completion", sessionID, key: `event:${String(event.data.id ?? sessionID)}` }
  }
  if (event.type === "session.execution.failed" && prefs.failure) {
    return { kind: "failure", sessionID, key: `event:${String(event.data.id ?? sessionID)}` }
  }
  if (event.type === "permission.asked" && prefs.needsAttention) {
    return { kind: "needs-attention", sessionID, key: `permission:${String(event.data.id ?? sessionID)}` }
  }
  if (event.type === "form.created" && prefs.needsAttention) {
    const form = event.data.form && typeof event.data.form === "object" ? (event.data.form as { id?: unknown }) : null
    return { kind: "needs-attention", sessionID, key: `form:${String(form?.id ?? sessionID)}` }
  }
  return null
}

function noticeCopy(kind: NotificationKind) {
  if (kind === "needs-attention") return "A session needs your attention."
  if (kind === "failure") return "A session response failed."
  return "A session response finished."
}

export function NotificationsProvider({ nav, children }: { nav: OpenCodeController; children: ReactNode }) {
  const support = useMemo(() => notificationFeatureState(), [])
  const [deviceID] = useState(() => notificationDeviceID())
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(support.permission)
  const [ready, setReady] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  const [sessions, setSessions] = useState<NotificationSession[]>([])
  const [busy, setBusy] = useState(false)
  const preferenceWriting = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const sessionsRef = useRef(sessions)
  const activeSessionIDRef = useRef(nav.activeSessionID)
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  useEffect(() => {
    activeSessionIDRef.current = nav.activeSessionID
  }, [nav.activeSessionID])
  const watchRequest = useRef(0)
  const watchQueue = useRef<Promise<void>>(Promise.resolve())
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const eventSourceReady = useRef(false)
  const seenRef = useRef<Set<string>>(new Set())
  const pendingSessionRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    setReady(false)
    setError(null)
    try {
      const value = await readNotificationState(deviceID)
      setEnabled(value.enabled)
      setPushEnabled(value.push)
      setPreferences(value.preferences)
      setSessions(value.sessions)
      setReady(true)
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Notifications are unavailable.")
    }
  }, [deviceID])

  useEffect(() => {
    void Promise.resolve().then(refresh)
  }, [refresh])

  useEffect(() => {
    const refreshPermission = () => {
      if (typeof Notification !== "undefined") setPermission(Notification.permission)
    }
    document.addEventListener("visibilitychange", refreshPermission)
    window.addEventListener("focus", refreshPermission)
    return () => {
      document.removeEventListener("visibilitychange", refreshPermission)
      window.removeEventListener("focus", refreshPermission)
    }
  }, [])

  const showNotice = useCallback((next: Notice) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice(next)
    noticeTimer.current = setTimeout(() => setNotice(null), 8000)
  }, [])

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    }
  }, [])

  const openNotice = useCallback(() => {
    if (!notice) return
    nav.selectSession(notice.sessionID)
    setNotice(null)
  }, [nav, notice])

  useEffect(() => {
    if (!navigator.serviceWorker) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; sessionID?: unknown } | null
      if (data?.type === "opencode-ui:notification-click" && typeof data.sessionID === "string") {
        nav.selectSession(data.sessionID)
        setNotice(null)
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage)
    return () => navigator.serviceWorker.removeEventListener("message", onMessage)
  }, [nav])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const sessionID = query.get("session")
    if (sessionID) pendingSessionRef.current = sessionID
    if (sessionID || query.has("notification")) {
      const url = new URL(window.location.href)
      url.searchParams.delete("session")
      url.searchParams.delete("notification")
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
    }
  }, [])

  useEffect(() => {
    const sessionID = pendingSessionRef.current
    if (!sessionID) return
    if (nav.sessions.some((session) => session.id === sessionID)) {
      nav.selectSession(sessionID)
      pendingSessionRef.current = null
    }
  }, [nav, nav.sessions])

  const pushSessions = useCallback(async (getNext: (current: NotificationSession[]) => NotificationSession[], activeSessionID: string | null) => {
    const request = ++watchRequest.current
    const operation = watchQueue.current.then(async () => {
      const next = getNext(sessionsRef.current)
      const value = await writeNotificationWatch(deviceID, next, activeSessionID)
      sessionsRef.current = value.sessions
      setSessions(value.sessions)
    })
    watchQueue.current = operation.catch(() => {})
    try {
      await operation
    } catch (failure) {
      if (request === watchRequest.current) {
        setError(failure instanceof Error ? failure.message : "Could not update watched sessions.")
      }
    }
  }, [deviceID])

  useEffect(() => {
    if (!enabled || !nav.activeSessionID) return
    const sessionID = nav.activeSessionID
    const title = nav.activeSession?.title
    void pushSessions((current) => activeSessionList(sessionID, title, current), sessionID)
  }, [enabled, nav.activeSessionID, nav.activeSession?.title, pushSessions])

  const enablePush = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      if (!support.secure) throw new Error("Notifications require HTTPS.")
      if (support.ios && !support.standalone) throw new Error("On iPhone, add OpenCode UI to the Home Screen, open the installed app, then enable notifications.")
      if (!support.supported) throw new Error("This browser does not support Web Push. In-app alerts are available while open.")
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== "granted") throw new Error("Notification permission was not granted. Enable in-app alerts or allow notifications in browser settings.")
      await navigator.serviceWorker.register("/notifications-sw.js", { scope: "/" })
      await navigator.serviceWorker.ready
      const publicKey = await readNotificationPublicKey()
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey.publicKey) as BufferSource,
        })
      }
      const nextSessions = activeSessionList(nav.activeSessionID, nav.activeSession?.title, sessionsRef.current)
      const value = await subscribeNotificationDevice({
        deviceID,
        subscription: subscription.toJSON(),
        preferences,
        sessions: nextSessions,
      })
      setEnabled(value.enabled)
      setPushEnabled(value.push)
      setPreferences(value.preferences)
      setSessions(value.sessions)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not enable notifications.")
    } finally {
      setBusy(false)
    }
  }, [deviceID, nav, preferences, support])

  const enableInApp = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const nextPreferences = { ...preferences, inApp: true }
      const nextSessions = activeSessionList(nav.activeSessionID, nav.activeSession?.title, sessionsRef.current)
      const value = await subscribeNotificationDevice({
        deviceID,
        subscription: null,
        preferences: nextPreferences,
        sessions: nextSessions,
      })
      setEnabled(value.enabled)
      setPushEnabled(value.push)
      setPreferences(value.preferences)
      setSessions(value.sessions)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not enable in-app alerts.")
    } finally {
      setBusy(false)
    }
  }, [deviceID, nav, preferences])

  const disable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const registration = await navigator.serviceWorker?.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      await subscription?.unsubscribe().catch(() => false)
      const value = await unsubscribeNotificationDevice(deviceID)
      setEnabled(value.enabled)
      setPushEnabled(value.push)
      setPreferences(value.preferences)
      setSessions(value.sessions)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not disable notifications.")
    } finally {
      setBusy(false)
    }
  }, [deviceID])

  const updatePreferences = useCallback(async (patch: Partial<NotificationPreferences>) => {
    if (preferenceWriting.current) return
    const next = { ...preferences, ...patch }
    setError(null)
    if (!enabled) {
      setPreferences(next)
      return
    }
    preferenceWriting.current = true
    setBusy(true)
    try {
      const value = await writeNotificationPreferences(deviceID, next)
      setPreferences(value.preferences)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save notification preferences.")
    } finally {
      preferenceWriting.current = false
      setBusy(false)
    }
  }, [deviceID, enabled, preferences])

  const clearSessions = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      await pushSessions(() => [], null)
    } finally {
      setBusy(false)
    }
  }, [pushSessions])

  const sendTest = useCallback(async () => {
    setError(null)
    try {
      if (!enabled) throw new Error("Enable notifications first.")
      const result = await testNotificationDevice(deviceID)
      if (!result.sent) showNotice({ kind: "completion", sessionID: nav.activeSessionID ?? "", text: "Test in-app alert. Notifications are not using Web Push on this device.", test: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not send the test notification.")
    }
  }, [deviceID, enabled, nav.activeSessionID, showNotice])

  useEffect(() => {
    if (!enabled || !preferences.inApp) return
    const source = new EventSource("/api/event")
    eventSourceRef.current = source
    eventSourceReady.current = false
    const onOpen = () => {
      eventSourceReady.current = true
      void sendNotificationHeartbeat(deviceID, document.visibilityState === "visible")
    }
    const onError = () => {
      eventSourceReady.current = false
      void sendNotificationHeartbeat(deviceID, false)
    }
    const onMessage = (event: MessageEvent) => {
      try {
        const envelope = JSON.parse(event.data) as { id?: string; type?: string; data?: Record<string, unknown> }
        if (!envelope.type || !envelope.data) return
        const notification = notificationFromEvent(envelope, preferences)
        if (!notification || !sessionsRef.current.some((session) => session.id === notification.sessionID)) return
        const key = `${notification.key}:${envelope.id ?? ""}`
        if (seenRef.current.has(key)) return
        seenRef.current.add(key)
        if (seenRef.current.size > 200) seenRef.current = new Set([...seenRef.current].slice(-100))
        if (document.visibilityState !== "visible" || notification.sessionID === activeSessionIDRef.current) return
        showNotice({ kind: notification.kind, sessionID: notification.sessionID, text: noticeCopy(notification.kind) })
      } catch {
        // Ignore malformed/non-app SSE frames.
      }
    }
    source.addEventListener("open", onOpen)
    source.addEventListener("error", onError)
    source.addEventListener("message", onMessage)
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !eventSourceReady.current) {
        void sendNotificationHeartbeat(deviceID, false)
      } else {
        void sendNotificationHeartbeat(deviceID, true)
      }
    }, 3000)
    const onVisibility = () => {
      void sendNotificationHeartbeat(deviceID, document.visibilityState === "visible" && eventSourceReady.current)
    }
    const onPageHide = () => {
      void sendNotificationHeartbeat(deviceID, false, true)
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", onPageHide)
    return () => {
      window.clearInterval(heartbeat)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onPageHide)
      source.removeEventListener("open", onOpen)
      source.removeEventListener("error", onError)
      source.removeEventListener("message", onMessage)
      source.close()
      eventSourceRef.current = null
      eventSourceReady.current = false
      void sendNotificationHeartbeat(deviceID, false, true)
    }
  }, [deviceID, enabled, preferences, showNotice])

  const value = useMemo<NotificationsContextValue>(
    () => ({
      support,
      permission,
      ready,
      enabled,
      pushEnabled,
      preferences,
      sessions,
      busy,
      error,
      enablePush,
      enableInApp,
      disable,
      updatePreferences,
      clearSessions,
      sendTest,
      refresh,
    }),
    [support, permission, ready, enabled, pushEnabled, preferences, sessions, busy, error, enablePush, enableInApp, disable, updatePreferences, clearSessions, sendTest, refresh]
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {notice && (notice.test || !notice.sessionID || notice.sessionID !== nav.activeSessionID) ? (
        <Alert className="fixed inset-x-3 top-16 z-[60] mx-auto max-w-md shadow-lg md:inset-x-auto md:end-6 md:top-20">
          <BellIcon aria-hidden="true" />
          <AlertTitle>
            {notice.kind === "needs-attention" ? "Needs attention" : notice.kind === "failure" ? "Response failed" : "Response finished"}
          </AlertTitle>
          <AlertDescription>
            <span>{notice.text}</span>
            <span className="mt-2 flex gap-2">
              {notice.sessionID ? (
                <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={openNotice}>
                  Open session
                </Button>
              ) : null}
              <Button type="button" variant="ghost" className="h-11 px-3 text-xs" onClick={() => setNotice(null)}>
                Dismiss
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
    </NotificationsContext.Provider>
  )
}

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext)
  if (!value) throw new Error("NotificationsProvider is missing")
  return value
}
