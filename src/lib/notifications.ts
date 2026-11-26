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

export type NotificationDeviceState = {
  enabled: boolean
  push: boolean
  preferences: NotificationPreferences
  sessions: NotificationSession[]
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  completion: true,
  needsAttention: true,
  failure: true,
  inApp: true,
  includeSessionTitle: false,
  sound: false,
}

const DEVICE_KEY = "opencode-ui.notification-device.v1"
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

/**
 * `crypto.randomUUID` only exists in secure contexts. The legacy HTTP tailnet
 * preview is deliberately still supported, so fall back to random bytes instead
 * of throwing during the first render and blanking the whole app.
 */
export function newNotificationDeviceID(): string {
  const cryptoApi = globalThis.crypto

  try {
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
      return cryptoApi.randomUUID()
    }
  } catch {
    // Fall through to random bytes.
  }

  const bytes = new Uint8Array(16)

  try {
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      cryptoApi.getRandomValues(bytes)
    } else {
      throw new Error("getRandomValues unavailable")
    }
  } catch {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function notificationDeviceID(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing && DEVICE_ID_PATTERN.test(existing)) return existing
    const created = newNotificationDeviceID()
    localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    // Storage can be unavailable (privacy mode); still return a usable id.
    return newNotificationDeviceID()
  }
}

export function notificationFeatureState() {
  const secure = typeof window !== "undefined" && window.isSecureContext === true
  const notification = typeof Notification !== "undefined"
  const serviceWorker = typeof navigator !== "undefined" && Boolean(navigator.serviceWorker)
  const push = typeof window !== "undefined" && Boolean(window.PushManager)
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : ""
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  return {
    secure,
    notification,
    serviceWorker,
    push,
    supported: secure && notification && serviceWorker && push,
    permission: notification ? Notification.permission : ("unsupported" as const),
    ios,
    standalone,
  }
}

export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null
    throw new Error(typeof body?.error === "string" ? body.error : `Notification request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

export function readNotificationState(deviceID: string) {
  return requestJSON<NotificationDeviceState>(`/api/ui/notifications/state?deviceId=${encodeURIComponent(deviceID)}`)
}

export function readNotificationPublicKey() {
  return requestJSON<{ publicKey: string; subject: string }>("/api/ui/notifications/public-key")
}

export function subscribeNotificationDevice(input: {
  deviceID: string
  subscription: PushSubscriptionJSON | null
  preferences: NotificationPreferences
  sessions: NotificationSession[]
}) {
  return requestJSON<NotificationDeviceState>("/api/ui/notifications/subscribe", {
    method: "POST",
    body: JSON.stringify({
      deviceId: input.deviceID,
      subscription: input.subscription,
      preferences: input.preferences,
      sessions: input.sessions,
    }),
  })
}

export function writeNotificationPreferences(deviceID: string, preferences: NotificationPreferences) {
  return requestJSON<{ enabled: boolean; preferences: NotificationPreferences }>("/api/ui/notifications/preferences", {
    method: "POST",
    body: JSON.stringify({ deviceId: deviceID, preferences }),
  })
}

export function writeNotificationWatch(deviceID: string, sessions: NotificationSession[], activeSessionID?: string | null) {
  return requestJSON<{ sessions: NotificationSession[] }>("/api/ui/notifications/watch", {
    method: "POST",
    body: JSON.stringify({ deviceId: deviceID, sessions, activeSessionID: activeSessionID ?? null }),
  })
}

export function sendNotificationHeartbeat(deviceID: string, visible: boolean, keepalive = false) {
  return fetch("/api/ui/notifications/heartbeat", {
    method: "POST",
    credentials: "same-origin",
    keepalive,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ deviceId: deviceID, visible }),
  }).catch(() => undefined)
}

export function testNotificationDevice(deviceID: string) {
  return requestJSON<{ sent: boolean; inApp: boolean }>("/api/ui/notifications/test", {
    method: "POST",
    body: JSON.stringify({ deviceId: deviceID }),
  })
}

export function unsubscribeNotificationDevice(deviceID: string) {
  return requestJSON<NotificationDeviceState>("/api/ui/notifications/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ deviceId: deviceID }),
  })
}
