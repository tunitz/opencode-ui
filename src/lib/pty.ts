/** Build the same-origin native PTY WebSocket URL with a short-lived ticket only. */
export function ptyWebSocketUrl({
  base,
  ptyID,
  ticket,
  directory,
  cursor,
}: {
  base: string
  ptyID: string
  ticket: string
  directory: string
  cursor?: number | null
}): string {
  const url = new URL(`/api/pty/${encodeURIComponent(ptyID)}/connect`, base)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("ticket", ticket)
  url.searchParams.set("location[directory]", directory)
  if (cursor !== undefined && cursor !== null) {
    url.searchParams.set("cursor", String(cursor))
  }
  return url.toString()
}

/** Read the server's binary control frame: 0x00 + JSON {cursor}. */
export function ptyCursorFromControlFrame(
  data: ArrayBuffer | Uint8Array
): number | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < 2 || bytes[0] !== 0) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(1)))
    if (
      parsed &&
      typeof parsed === "object" &&
      "cursor" in parsed &&
      typeof parsed.cursor === "number" &&
      Number.isSafeInteger(parsed.cursor)
    ) {
      return parsed.cursor
    }
  } catch {
    // Malformed control frames are ignored; terminal bytes are never parsed as JSON.
  }
  return null
}

/**
 * Strip OSC 52 clipboard writes and OSC 8 hyperlinks from terminal output.
 * Incomplete sequences are held until the next chunk so a split malicious
 * sequence cannot execute. Other terminal control sequences are preserved.
 */
export class PtyOutputFilter {
  private pending = ""

  push(chunk: string): string {
    const data = this.pending + chunk
    this.pending = ""
    let output = ""
    let index = 0

    while (index < data.length) {
      const start = data.indexOf("\x1b]", index)
      if (start === -1) {
        output += data.slice(index)
        break
      }
      output += data.slice(index, start)
      const semicolon = data.indexOf(";", start + 2)
      if (semicolon === -1) {
        this.pending = data.slice(start)
        break
      }
      const code = data.slice(start + 2, semicolon)
      const unsafe = code === "52" || code === "8"
      const bel = data.indexOf("\x07", semicolon + 1)
      const st = data.indexOf("\x1b\\", semicolon + 1)
      const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)
      if (end === -1) {
        this.pending = data.slice(start)
        // Bound a malformed unfinished sequence instead of retaining unbounded output.
        if (this.pending.length > 8192) this.pending = ""
        break
      }
      const terminator = end === bel ? 1 : 2
      if (!unsafe) output += data.slice(start, end + terminator)
      index = end + terminator
    }
    return output
  }
}

/** Redact the ticket for any error/diagnostic rendering. */
export function redactPtyUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has("ticket")) {
      parsed.searchParams.set("ticket", "[redacted]")
    }
    return parsed.toString()
  } catch {
    return "[invalid terminal URL]"
  }
}
