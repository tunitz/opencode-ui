/*
 * OpenCode UI push-only service worker.
 * No fetch handler, offline cache, app-asset caching, or background sync.
 * Notifications are always shown for received Web Push (userVisibleOnly).
 */
self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const type = typeof data.type === "string" ? data.type : "completion"
  const title =
    typeof data.title === "string" && data.title.trim()
      ? data.title.slice(0, 120)
      : "OpenCode UI"
  const body =
    typeof data.body === "string" && data.body.trim()
      ? data.body.slice(0, 240)
      : "Open OpenCode UI to view your session."
  const sessionID =
    typeof data.sessionID === "string" ? data.sessionID.slice(0, 160) : ""
  const tag =
    typeof data.tag === "string" && data.tag.length < 220
      ? data.tag
      : `opencode-ui:${sessionID}:${type}`
  let url = "/"
  try {
    const candidate = new URL(typeof data.url === "string" ? data.url : "/", self.location.origin)
    if (candidate.origin === self.location.origin) {
      url = `${candidate.pathname}${candidate.search}`
    }
  } catch {
    url = "/"
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: false,
      silent: data.sound !== true,
      icon: "/icons/icon-192.png",
      badge: "/favicon-32x32.png",
      data: { type, sessionID, url },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  let url = "/"
  try {
    const candidate = new URL(typeof data.url === "string" ? data.url : "/", self.location.origin)
    if (candidate.origin === self.location.origin) {
      url = `${candidate.pathname}${candidate.search}`
    }
  } catch {
    url = "/"
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const client of windows) {
        if (client.url && new URL(client.url).origin === self.location.origin) {
          await client.focus()
          client.postMessage({
            type: "opencode-ui:notification-click",
            sessionID: typeof data.sessionID === "string" ? data.sessionID : null,
            url,
          })
          return
        }
      }
      await self.clients.openWindow(url)
    })()
  )
})
