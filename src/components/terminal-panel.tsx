import { useEffect, useRef, useState } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import {
  ClipboardPasteIcon,
  CopyIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCwIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { InspectorPanelHandle } from "@/components/files-panel"
import {
  PtyOutputFilter,
  ptyCursorFromControlFrame,
  ptyWebSocketUrl,
  redactPtyUrl,
} from "@/lib/pty"
import {
  errorMessage,
  openCode,
  type Pty,
} from "@/lib/opencode"
import type { OpenCodeController } from "@/lib/use-opencode"

type TerminalState =
  | "idle"
  | "loading"
  | "connecting"
  | "connected"
  | "disconnected"
  | "exited"
  | "error"

function terminalTheme() {
  const dark = document.documentElement.classList.contains("dark")
  return dark
    ? {
        background: "#1b1b1f",
        foreground: "#f4f4f5",
        cursor: "#8ec5ff",
        selectionBackground: "#334155",
        black: "#17171a",
        red: "#ff8d92",
        green: "#8ee6b8",
        yellow: "#f2d083",
        blue: "#8ec5ff",
        magenta: "#d4b0ff",
        cyan: "#83e4e4",
        white: "#f4f4f5",
        brightBlack: "#7c7d86",
        brightRed: "#ffb3b6",
        brightGreen: "#b8f3d4",
        brightYellow: "#ffe5a3",
        brightBlue: "#b9dbff",
        brightMagenta: "#ead4ff",
        brightCyan: "#b8f5f5",
        brightWhite: "#ffffff",
      }
    : {
        background: "#ffffff",
        foreground: "#1b1b1f",
        cursor: "#0b6cf0",
        selectionBackground: "#dbeafe",
        black: "#1b1b1f",
        red: "#b42318",
        green: "#157347",
        yellow: "#8a5a00",
        blue: "#0b5fc6",
        magenta: "#7e3fa8",
        cyan: "#006d77",
        white: "#f4f4f5",
        brightBlack: "#6b7280",
        brightRed: "#dc2626",
        brightGreen: "#15803d",
        brightYellow: "#a16207",
        brightBlue: "#1d4ed8",
        brightMagenta: "#9333ea",
        brightCyan: "#0e7490",
        brightWhite: "#ffffff",
      }
}

function timestampLabel() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function TerminalPanel({
  nav,
  refreshRef,
}: {
  nav: OpenCodeController
  refreshRef?: { current: InspectorPanelHandle | null }
}) {
  const directory = nav.activeSession?.location?.directory ?? null
  const [terminals, setTerminals] = useState<Pty[]>([])
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "error">("loading")
  const [listError, setListError] = useState<string | null>(null)
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [connection, setConnection] = useState<TerminalState>("idle")
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [reconnectKey, setReconnectKey] = useState(0)
  const [selection, setSelection] = useState("")
  const [pasteText, setPasteText] = useState<string | null>(null)
  const [terminateOpen, setTerminateOpen] = useState(false)
  const [terminating, setTerminating] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const listRequest = useRef(0)
  const selected = terminals.find((terminal) => terminal.id === selectedID) ?? null

  async function loadTerminals(): Promise<string | null> {
    if (!directory) {
      const message = "This session has no project directory."
      setListStatus("error")
      setListError(message)
      return message
    }
    const request = ++listRequest.current
    setListStatus("loading")
    setListError(null)
    try {
      const response = await openCode.pty.list({
        location: { directory },
      })
      if (request !== listRequest.current) return null
      setTerminals(response.data)
      setSelectedID((current) =>
        current && response.data.some((terminal) => terminal.id === current)
          ? current
          : null
      )
      setListStatus("ready")
      return null
    } catch (error) {
      if (request !== listRequest.current) return null
      const message = errorMessage(error)
      setListStatus("error")
      setListError(message)
      return message
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadTerminals())
    return () => {
      listRequest.current += 1
    }
    // The sheet is mounted only while open; directory/session changes close it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory])

  useEffect(() => {
    if (!refreshRef) return
    refreshRef.current = { refresh: loadTerminals }
    return () => {
      refreshRef.current = null
    }
  })

  useEffect(() => {
    if (!selected || !directory || selected.status !== "running") {
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
      void Promise.resolve().then(() =>
        setConnection(selected?.status === "exited" ? "exited" : "idle")
      )
      return
    }

    const host = hostRef.current
    if (!host) return

    let disposed = false
    let socket: WebSocket | null = null
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let fitTimer: ReturnType<typeof setTimeout> | null = null
    const filter = new PtyOutputFilter()
    const decoder = new TextDecoder()
    setConnection("connecting")
    setTerminalError(null)
    setSelection("")

    const term = new Terminal({
      cursorBlink: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 3000,
      theme: terminalTheme(),
      allowProposedApi: false,
      convertEol: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    terminalRef.current = term
    fitRef.current = fit

    const sendSize = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (!selected || !directory) return
        const cols = Math.max(2, term.cols)
        const rows = Math.max(2, term.rows)
        void openCode.pty
          .update({
            ptyID: selected.id,
            location: { directory },
            size: { cols, rows },
          })
          .catch(() => {})
      }, 120)
    }

    term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data)
    })
    term.onSelectionChange(() => setSelection(term.getSelection()))
    term.open(host)
    fit.fit()
    host.scrollIntoView({ block: "nearest", inline: "nearest" })
    sendSize()

    const scheduleFit = () => {
      if (disposed) return
      if (fitTimer) clearTimeout(fitTimer)
      fitTimer = setTimeout(() => {
        if (disposed) return
        try {
          fit.fit()
          sendSize()
        } catch {
          // A hidden/closing sheet can have zero size; ignore that transient.
        }
      }, 80)
    }
    window.addEventListener("resize", scheduleFit)
    window.visualViewport?.addEventListener("resize", scheduleFit)
    const resizeObserver = new ResizeObserver(() => scheduleFit())
    resizeObserver.observe(host)

    const readMessage = (data: ArrayBuffer | string) => {
      if (disposed) return
      if (typeof data === "string") {
        term.write(filter.push(data))
        return
      }
      const bytes = new Uint8Array(data)
      if (bytes[0] === 0) {
        ptyCursorFromControlFrame(bytes)
        return
      }
      term.write(filter.push(decoder.decode(bytes, { stream: true })))
    }

    void (async () => {
      try {
        const token = await openCode.pty.connect.token({
          ptyID: selected.id,
          location: { directory },
          "x-opencode-ticket": "1",
        })
        if (disposed) return
        const url = ptyWebSocketUrl({
          base: window.location.origin,
          ptyID: selected.id,
          ticket: token.data.ticket,
          directory,
        })
        socket = new WebSocket(url)
        socket.binaryType = "arraybuffer"
        socketRef.current = socket
        socket.onopen = () => {
          if (disposed) return
          setConnection("connected")
          setStatusText(`Connected to terminal · ${timestampLabel()}`)
          sendSize()
        }
        socket.onmessage = (event) => {
          if (typeof event.data === "string" || event.data instanceof ArrayBuffer) {
            readMessage(event.data)
          }
        }
        socket.onerror = () => {
          if (disposed) return
          setConnection("error")
          setTerminalError("Terminal WebSocket connection failed.")
        }
        socket.onclose = (event) => {
          if (disposed) return
          if (event.code === 4404) {
            setConnection("exited")
            setTerminalError("Terminal session has exited.")
          } else {
            setConnection("disconnected")
            setStatusText(
              event.reason
                ? `Disconnected: ${event.reason}`
                : "Disconnected. Reconnect to resume output; keystrokes are not replayed."
            )
          }
        }
      } catch (error) {
        if (disposed) return
        setConnection("error")
        setTerminalError(
          `${errorMessage(error)} (${redactPtyUrl(
            window.location.origin + "/api/pty/" + selected.id + "/connect"
          )})`
        )
      }
    })()

    return () => {
      disposed = true
      window.removeEventListener("resize", scheduleFit)
      window.visualViewport?.removeEventListener("resize", scheduleFit)
      resizeObserver.disconnect()
      if (fitTimer) clearTimeout(fitTimer)
      if (resizeTimer) clearTimeout(resizeTimer)
      socket?.close()
      if (socketRef.current === socket) socketRef.current = null
      term.dispose()
      if (terminalRef.current === term) {
        terminalRef.current = null
        fitRef.current = null
      }
    }
    // selected is intentionally narrowed to id/status: list refreshes must not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory, reconnectKey, selected?.id, selected?.status])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (terminalRef.current) terminalRef.current.options.theme = terminalTheme()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])

  async function createTerminal() {
    if (!directory || creating) return
    setCreating(true)
    setTerminalError(null)
    setStatusText("Creating terminal…")
    try {
      const response = await openCode.pty.create({
        location: { directory },
        cwd: directory,
        title: "Terminal",
      })
      setTerminals((current) => [response.data, ...current])
      setSelectedID(response.data.id)
      setReconnectKey((current) => current + 1)
      setStatusText(`Created terminal · ${timestampLabel()}`)
    } catch (error) {
      setTerminalError(errorMessage(error))
      setStatusText(null)
    } finally {
      setCreating(false)
    }
  }

  async function terminate() {
    if (!selected || !directory || terminating) return
    setTerminating(true)
    setTerminalError(null)
    try {
      await openCode.pty.remove({
        ptyID: selected.id,
        location: { directory },
      })
      setTerminals((current) => current.filter((terminal) => terminal.id !== selected.id))
      setSelectedID(null)
      setConnection("idle")
      setTerminateOpen(false)
      setStatusText("Terminal terminated.")
    } catch (error) {
      setTerminalError(errorMessage(error))
    } finally {
      setTerminating(false)
    }
  }

  async function paste() {
    setTerminalError(null)
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error("Clipboard read is unavailable in this browser context.")
      }
      const text = await navigator.clipboard.readText()
      if (!text) return
      if (/\r|\n/.test(text)) {
        setPasteText(text)
        return
      }
      terminalRef.current?.paste(text)
      setStatusText("Pasted into terminal.")
    } catch (error) {
      setTerminalError(errorMessage(error))
    }
  }

  async function copySelection() {
    if (!selection) return
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard write is unavailable in this browser context.")
      }
      await navigator.clipboard.writeText(selection)
      setStatusText("Copied terminal selection.")
    } catch (error) {
      setTerminalError(errorMessage(error))
    }
  }

  const canConnect = Boolean(directory) && !creating
  const connectionLabel =
    connection === "connected"
      ? "Connected"
      : connection === "connecting"
        ? "Connecting…"
        : connection === "disconnected"
          ? "Disconnected"
          : connection === "exited"
            ? "Exited"
            : connection === "error"
              ? "Error"
              : "Not connected"

  return (
    <>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4">
            <div className="flex min-w-0 items-center gap-2">
              {listStatus === "loading" ? (
                <span role="status" className="text-[11px] text-muted-foreground">
                  Loading terminals…
                </span>
              ) : null}
              <Button
                type="button"
                size="icon-lg"
                aria-label="New terminal"
                className="ms-auto size-11 shrink-0 rounded-full p-0"
                onClick={() => void createTerminal()}
                disabled={!canConnect}
              >
                {creating ? (
                  <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <PlusIcon aria-hidden="true" className="size-4" />
                )}
              </Button>
            </div>

            {terminals.length > 0 ? (
              <div
                role="list"
                aria-label="Project terminals"
                className="max-h-24 shrink-0 overflow-y-auto rounded-lg border border-border/70"
              >
                {terminals.map((terminal) => (
                  <div key={terminal.id} role="listitem">
                    <button
                      type="button"
                      aria-label={`Open terminal ${terminal.title}`}
                      aria-pressed={terminal.id === selectedID}
                      className="flex min-h-11 w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-start text-[12px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-muted"
                      onClick={() => {
                        setSelectedID(terminal.id)
                        setReconnectKey((current) => current + 1)
                      }}
                    >
                      <SquareTerminalIcon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{terminal.title}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {terminal.status} · {terminal.command} · {terminal.cwd}
                        </span>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {listError ? (
              <div role="alert" className="space-y-1 text-xs text-destructive">
                <p className="break-words">{listError}</p>
                <Button type="button" variant="outline" className="h-11 px-3 text-xs" onClick={() => void loadTerminals()}>
                  Retry
                </Button>
              </div>
            ) : null}

            {terminals.length === 0 && listStatus === "ready" ? (
              <div className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground">
                <p>No terminal exists in this project directory.</p>
                <p className="mt-1">Create one explicitly to start a host shell.</p>
              </div>
            ) : null}

            {selected ? (
              <>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="me-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span
                      className={
                        connection === "connected"
                          ? "size-2 rounded-full bg-diff-added"
                          : connection === "error" || connection === "exited"
                            ? "size-2 rounded-full bg-diff-removed"
                            : "size-2 rounded-full bg-muted-foreground"
                      }
                      aria-hidden="true"
                    />
                    <span role="status" aria-live="polite">
                      {connectionLabel}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 px-3 text-xs"
                    aria-label="Reconnect terminal"
                    disabled={connection === "connecting"}
                    onClick={() => setReconnectKey((current) => current + 1)}
                  >
                    <RotateCwIcon aria-hidden="true" className="size-4" />
                    Reconnect
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 px-3 text-xs"
                    aria-label="Copy terminal selection"
                    disabled={!selection}
                    onClick={() => void copySelection()}
                  >
                    <CopyIcon aria-hidden="true" className="size-4" />
                    Copy
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 px-3 text-xs"
                    aria-label="Paste into terminal"
                    onClick={() => void paste()}
                  >
                    <ClipboardPasteIcon aria-hidden="true" className="size-4" />
                    Paste
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-11 px-3 text-xs"
                    aria-label="Terminate terminal"
                    onClick={() => setTerminateOpen(true)}
                  >
                    <Trash2Icon aria-hidden="true" className="size-4" />
                    Terminate
                  </Button>
                </div>
                {terminalError ? (
                  <p role="alert" className="text-xs break-words text-destructive">
                    {terminalError}
                  </p>
                ) : null}
                {statusText ? (
                  <p role="status" className="text-[11px] break-words text-muted-foreground">
                    {statusText}
                  </p>
                ) : null}
                <div
                  ref={hostRef}
                  data-testid="terminal-screen"
                  dir="ltr"
                  className="min-h-[10rem] flex-1 overflow-hidden rounded-lg border border-border bg-[#1b1b1f] p-2 focus-within:ring-2 focus-within:ring-ring/50"
                />
                {selected.status === "exited" ? (
                  <p className="text-[11px] text-muted-foreground">
                    Terminal exited{selected.exitCode !== undefined ? ` with code ${selected.exitCode}` : ""}. It remains listed until terminated.
                  </p>
                ) : null}
              </>
            ) : null}
      </div>

      <AlertDialog open={pasteText !== null} onOpenChange={(open) => !open && setPasteText(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Paste multiple lines?</AlertDialogTitle>
            <AlertDialogDescription>
              Pasted newlines may execute in the shell. Only paste content you trust.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pasteText !== null) terminalRef.current?.paste(pasteText)
                setPasteText(null)
                setStatusText("Pasted into terminal.")
              }}
            >
              Paste
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={terminateOpen} onOpenChange={setTerminateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends the host shell process. Closing the viewer alone leaves it running.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={terminating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={terminating}
              aria-busy={terminating}
              onClick={() => void terminate()}
            >
              {terminating ? (
                <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              Terminate terminal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
