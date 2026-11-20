import { useCallback, useEffect, useRef, useState } from "react"
import type { Terminal } from "@xterm/xterm"
import type { FitAddon } from "@xterm/addon-fit"

import { openCode } from "@/lib/opencode"
import {
  parseConnectTicket,
  ptyWebSocketUrl,
  sanitizeTerminalText,
  terminalDisconnectMessage,
} from "@/lib/terminal/pty"

export type PtyStatus = "idle" | "connecting" | "connected" | "disconnected" | "error"

export type UsePtyOptions = {
  /** Absolute working directory used for the pty location. */
  directory: string
  /** Optional session id, used only for an accessible label. */
  sessionID?: string
  /** Run the connection only while the owning dialog is open. */
  enabled: boolean
  /** Injectable for tests; defaults to the same-origin singleton client. */
  client?: typeof openCode
}

export type UsePtyResult = {
  containerRef: React.RefObject<HTMLDivElement | null>
  status: PtyStatus
  message: string | null
  label: string
  /** Explicit reattach only — never an automatic retry loop. */
  reattach: () => void
}

type XtermModules = {
  Terminal: typeof import("@xterm/xterm").Terminal
  FitAddon: typeof import("@xterm/addon-fit").FitAddon
}

let modulesPromise: Promise<XtermModules> | null = null

/** xterm is loaded on first open so it stays out of the main bundle. */
function loadXterm(): Promise<XtermModules> {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/xterm/css/xterm.css"),
    ])
      .then(([xterm, fit]) => ({
        Terminal: xterm.Terminal,
        FitAddon: fit.FitAddon,
      }))
      .catch((failure) => {
        // A transient import failure must not poison every later open.
        modulesPromise = null
        throw failure
      })
  }
  return modulesPromise
}

export function usePty({
  directory,
  sessionID,
  enabled,
  client = openCode,
}: UsePtyOptions): UsePtyResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const intentionalCloseRef = useRef(false)
  const reattachRef = useRef<() => void>(() => {})
  const [status, setStatus] = useState<PtyStatus>("idle")
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const generation = ++generationRef.current
    const isCurrent = () => !cancelled && generationRef.current === generation
    let observer: ResizeObserver | null = null
    let frame = 0

    const cancelFrame = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }

    const closeSocket = (intentional: boolean) => {
      intentionalCloseRef.current = intentional
      const socket = socketRef.current
      socketRef.current = null
      if (!socket) return
      try {
        if (intentional) socket.close(1000, "Client closed")
        else socket.close()
      } catch {
        /* Already closing. */
      }
    }

    const ensureTerminal = async (): Promise<Terminal> => {
      if (terminalRef.current) return terminalRef.current
      const { Terminal: Xterm, FitAddon: Fit } = await loadXterm()
      if (!isCurrent()) throw new Error("Terminal closed during load")
      const container = containerRef.current
      if (!container) throw new Error("Terminal container is not mounted")
      const term = new Xterm({
        allowProposedApi: false,
        convertEol: true,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.25,
        scrollback: 2000,
        theme: {
          background: "#0b0b0f",
          foreground: "#d1d5db",
          cursor: "#a3a3a3",
          selectionBackground: "#3f3f46",
        },
      })
      const fit = new Fit()
      term.loadAddon(fit)
      term.open(container)
      if (!isCurrent()) {
        term.dispose()
        throw new Error("Terminal closed during load")
      }
      term.onData((data) => {
        const socket = socketRef.current
        if (socket && socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(data)
          } catch {
            /* Socket closed between the check and the send. */
          }
        }
      })
      terminalRef.current = term
      fitAddonRef.current = fit
      return term
    }

    const syncPtySize = (term: Terminal) => {
      const ptyID = ptyIdRef.current
      if (!ptyID || term.cols <= 0 || term.rows <= 0) return
      void client.pty
        .update({ ptyID, location: { directory }, size: { cols: term.cols, rows: term.rows } })
        .catch(() => { /* Resize is best effort. */ })
    }

    const scheduleResize = () => {
      cancelFrame()
      frame = requestAnimationFrame(() => {
        if (cancelled) return
        const fit = fitAddonRef.current
        const term = terminalRef.current
        if (!fit || !term) return
        const before = { cols: term.cols, rows: term.rows }
        try { fit.fit() } catch { return }
        if (term.cols === before.cols && term.rows === before.rows) return
        syncPtySize(term)
      })
    }

    const connect = async (forceFreshPty = false) => {
      const attempt = ++generationRef.current
      const isAttemptCurrent = () => !cancelled && generationRef.current === attempt
      setStatus("connecting")
      setMessage(null)
      try {
        const term = await ensureTerminal()
        if (!isAttemptCurrent()) return

        if (typeof ResizeObserver !== "undefined" && containerRef.current && !observer) {
          observer = new ResizeObserver(scheduleResize)
          observer.observe(containerRef.current)
        }

        if (forceFreshPty) ptyIdRef.current = null
        let ptyID = ptyIdRef.current
        if (!ptyID) {
          const listed = await client.pty.list({ location: { directory } })
          if (!isAttemptCurrent()) return
          const reusable = listed.data.find((pty) => pty.status === "running")
          if (reusable) {
            ptyID = reusable.id
          } else {
            const created = await client.pty.create({ location: { directory } })
            if (!isAttemptCurrent()) return
            ptyID = created.data.id
          }
          ptyIdRef.current = ptyID
        }

        // A fresh ticket is minted for every attempt, including reattaches.
        const token = await client.pty.connect.token({
          ptyID,
          location: { directory },
          "x-opencode-ticket": "1",
        })
        if (!isAttemptCurrent()) return
        const { ticket } = parseConnectTicket(token)
        const url = ptyWebSocketUrl(
          { protocol: window.location.protocol, host: window.location.host },
          { ptyID, ticket, directory }
        )

        closeSocket(false)
        const socket = new WebSocket(url)
        socket.binaryType = "arraybuffer"
        socketRef.current = socket

        socket.onopen = () => {
          if (!isAttemptCurrent()) {
            try { socket.close() } catch { /* ignore */ }
            return
          }
          setStatus("connected")
          setMessage(null)
          cancelFrame()
          frame = requestAnimationFrame(() => {
            if (!isAttemptCurrent()) return
            try {
              fitAddonRef.current?.fit()
              syncPtySize(term)
            } catch { /* not laid out yet */ }
            try { term.focus() } catch { /* ignore */ }
          })
        }
        socket.onmessage = (event) => {
          if (!isAttemptCurrent()) return
          const data = event.data
          if (typeof data === "string") term.write(data)
          else if (data instanceof ArrayBuffer) term.write(new Uint8Array(data))
          else if (ArrayBuffer.isView(data)) {
            term.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
          }
        }
        socket.onerror = () => {
          if (!isAttemptCurrent()) return
          setStatus("error")
          setMessage("Terminal connection failed")
        }
        socket.onclose = (event) => {
          if (!isAttemptCurrent()) return
          // A stale socket closing during reattach must not overwrite the new
          // connection's status. The current socket is the only one that owns
          // the visible connection state.
          if (socketRef.current !== socket) return
          socketRef.current = null
          if (intentionalCloseRef.current) return
          // Clear cached PTY id so explicit Reattach checks running PTYs or creates a new one.
          ptyIdRef.current = null
          setStatus("disconnected")
          setMessage(terminalDisconnectMessage(event))
        }
      } catch (failure) {
        if (!isAttemptCurrent()) return
        ptyIdRef.current = null
        setStatus("error")
        setMessage(
          sanitizeTerminalText(
            failure instanceof Error ? failure.message : String(failure),
            "Terminal connection failed"
          )
        )
      }
    }

    reattachRef.current = () => { void connect(true) }
    void connect(false)

    return () => {
      cancelled = true
      generationRef.current += 1
      reattachRef.current = () => {}
      cancelFrame()
      observer?.disconnect()
      closeSocket(true)
      const term = terminalRef.current
      terminalRef.current = null
      fitAddonRef.current = null
      ptyIdRef.current = null
      try { term?.dispose() } catch { /* ignore */ }
    }
  }, [client, directory, enabled])

  const reattach = useCallback(() => reattachRef.current(), [])
  const label = sessionID ? `Terminal for session ${sessionID}` : "Terminal"
  return { containerRef, status, message, label, reattach }
}
