import { describe, expect, test } from "bun:test"
import {
  buildConnectQuery,
  isValidConnectTicket,
  parseConnectTicket,
  ptyWebSocketUrl,
  sanitizeTerminalText,
  terminalDisconnectMessage,
} from "../src/lib/terminal/pty"

describe("ptyWebSocketUrl", () => {
  test("maps http to ws with the bridge path and ticket query", () => {
    const url = new URL(
      ptyWebSocketUrl(
        { protocol: "http:", host: "192.168.1.10:5175" },
        { ptyID: "pty-123", ticket: "ticket-abc", directory: "/home/u/project" }
      )
    )
    expect(url.protocol).toBe("ws:")
    expect(url.host).toBe("192.168.1.10:5175")
    expect(url.pathname).toBe("/api/pty/pty-123/connect")
    expect(url.searchParams.get("ticket")).toBe("ticket-abc")
    expect(url.searchParams.get("location[directory]")).toBe("/home/u/project")
    expect(url.searchParams.has("cursor")).toBe(false)
  })

  test("maps https to wss (no HTTPS gate) and keeps a non-loopback host", () => {
    const result = ptyWebSocketUrl(
      { protocol: "https:", host: "ui.example.test" },
      { ptyID: "pty/with space", ticket: "t", directory: "/srv/app" }
    )
    expect(result.startsWith("wss://ui.example.test/api/pty/")).toBe(true)
    expect(result).toContain("/api/pty/pty%2Fwith%20space/connect")
    expect(new URL(result).searchParams.get("ticket")).toBe("t")
  })

  test("other protocols fall back to ws (plain HTTP is supported)", () => {
    const url = new URL(
      ptyWebSocketUrl(
        { protocol: "ftp:", host: "host:9" },
        { ptyID: "id", ticket: "t" }
      )
    )
    expect(url.protocol).toBe("ws:")
  })
})

describe("buildConnectQuery", () => {
  test("includes ticket, directory and a valid cursor in native order", () => {
    const query = buildConnectQuery({
      ticket: "tk",
      directory: "/a b",
      cursor: 0,
    })
    expect(query.toString()).toBe(
      "location%5Bdirectory%5D=%2Fa+b&cursor=0&ticket=tk"
    )
  })

  test("omits empty directory and a non-finite cursor", () => {
    const query = buildConnectQuery({
      ticket: "tk",
      directory: "",
      cursor: Number.NaN,
    })
    expect(query.toString()).toBe("ticket=tk")
  })
})

describe("parseConnectTicket", () => {
  test("reads the native { data: { ticket, expires_in } } shape", () => {
    expect(
      parseConnectTicket({ location: {}, data: { ticket: "abc", expires_in: 30 } })
    ).toEqual({ ticket: "abc", expiresIn: 30 })
  })

  test("accepts a bare token and tolerates a bad expiry", () => {
    expect(parseConnectTicket({ ticket: "xyz", expires_in: "soon" })).toEqual({
      ticket: "xyz",
      expiresIn: null,
    })
  })

  test("rejects missing or blank tickets", () => {
    expect(() => parseConnectTicket({ data: {} })).toThrow(/missing/)
    expect(() => parseConnectTicket({ data: { ticket: "   " } })).toThrow(/missing/)
    expect(() => parseConnectTicket({ data: { ticket: 42 } })).toThrow(/missing/)
    expect(() => parseConnectTicket(null)).toThrow(/empty/)
  })

  test("validates the opaque ticket charset and length without sanitizing it", () => {
    expect(isValidConnectTicket("tkt_ABC.123-~+/=")).toBe(true)
    expect(isValidConnectTicket("a".repeat(512))).toBe(true)
    expect(isValidConnectTicket("")).toBe(false)
    expect(isValidConnectTicket("a".repeat(513))).toBe(false)
    expect(() => parseConnectTicket({ data: { ticket: "a".repeat(513) } })).toThrow(/invalid/)
    expect(() => parseConnectTicket({ data: { ticket: "bad ticket\n" } })).toThrow(/invalid/)
    expect(() => parseConnectTicket({ data: { ticket: "esc\u001b[31m" } })).toThrow(/invalid/)
  })
})

describe("terminal text and close reasons", () => {
  test("sanitizeTerminalText strips control characters and caps length", () => {
    expect(sanitizeTerminalText("hello\u001b[31m world")).toBe("hello [31m world")
    expect(sanitizeTerminalText("  a   b\n c  ")).toBe("a b c")
    expect(sanitizeTerminalText("x".repeat(500)).length).toBe(160)
    expect(sanitizeTerminalText(null, "fallback")).toBe("fallback")
  })

  test("terminalDisconnectMessage maps sanitized backpressure and size reasons", () => {
    expect(terminalDisconnectMessage({ code: 1013, reason: "Backpressure limit" })).toBe(
      "Terminal disconnected — backpressure limit reached"
    )
    expect(terminalDisconnectMessage({ code: 1009, reason: "Message too large" })).toBe(
      "Terminal disconnected — message too large"
    )
    expect(terminalDisconnectMessage({ code: 1000, wasClean: true })).toBe("Terminal closed")
    expect(terminalDisconnectMessage({ code: 1006, reason: "Upstream closed" })).toBe(
      "Terminal disconnected — Upstream closed"
    )
  })

  test("close reasons cannot inject control sequences", () => {
    const message = terminalDisconnectMessage({ reason: "bad\u0007\u001b[2Jreason" })
    expect(message).toBe("Terminal disconnected — bad [2Jreason")
    expect(message).not.toContain("\u001b")
  })
})

describe("terminal UI lifecycle guards", () => {
  const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text()

  test("the disconnected overlay owns the single Reattach control", async () => {
    const source = await read("../src/components/terminal-dialog.tsx")
    expect(source.match(/Reattach/g) ?? []).toHaveLength(1)
  })

  test("a failed xterm import clears the cached promise so later opens retry", async () => {
    const source = await read("../src/lib/terminal/use-pty.ts")
    expect(source).toContain("modulesPromise = null")
    expect(source).toContain("throw failure")
  })
})
