// Decode only a bounded prefix; data URLs may be base64 or percent encoded.
export function decodePreviewText(dataUrl: string, limit: number): { text: string; truncated: boolean } | null {
  const comma = dataUrl.indexOf(",")
  if (!dataUrl.startsWith("data:") || comma < 0) return null
  const base64 = dataUrl.slice(5, comma).split(";").some((part) => part.toLowerCase() === "base64")
  const start = comma + 1
  try {
    if (base64) {
      const max = Math.ceil((limit + 1) / 3) * 4
      let index = start
      let encoded = ""
      while (index < dataUrl.length && encoded.length < max) {
        if (dataUrl[index] === "%") {
          const hex = dataUrl.slice(index + 1, index + 3)
          if (!/^[\da-f]{2}$/i.test(hex)) return null
          encoded += String.fromCharCode(parseInt(hex, 16))
          index += 3
        } else {
          encoded += dataUrl[index++]
        }
      }
      // Avoid cutting an encoded quartet when a valid URL contains whitespace.
      if (index < dataUrl.length) {
        encoded = encoded.replace(/[\t\n\f\r ]/g, "")
        encoded = encoded.slice(0, encoded.length - (encoded.length % 4))
      }
      const binary = atob(encoded)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      return { text: new TextDecoder().decode(bytes.subarray(0, limit)), truncated: bytes.length > limit || index < dataUrl.length }
    }
    const bytes: number[] = []
    const encoder = new TextEncoder()
    let index = start
    while (index < dataUrl.length && bytes.length <= limit) {
      if (dataUrl[index] === "%") {
        const hex = dataUrl.slice(index + 1, index + 3)
        if (!/^[\da-f]{2}$/i.test(hex)) return null
        bytes.push(parseInt(hex, 16))
        index += 3
      } else {
        const point = dataUrl.codePointAt(index)!
        const char = String.fromCodePoint(point)
        bytes.push(...encoder.encode(char))
        index += char.length
      }
    }
    return { text: new TextDecoder().decode(Uint8Array.from(bytes.slice(0, limit))), truncated: bytes.length > limit || index < dataUrl.length }
  } catch {
    return null
  }
}

// Do not rely on a server honoring Range: retain at most one byte beyond the
// preview limit and cancel the stream as soon as truncation is established.
export async function readPreviewText(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let truncated = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = limit - length
      if (remaining > 0) {
        const prefix = value.subarray(0, remaining)
        chunks.push(prefix.slice())
        length += prefix.byteLength
      }
      if (value.byteLength > remaining) {
        truncated = true
        void reader.cancel().catch(() => {})
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const range = /^bytes\s+\d+-(\d+)\/(\d+)$/i.exec(response.headers.get("content-range") ?? "")
  if (range && Number(range[1]) + 1 < Number(range[2])) truncated = true
  return { text: new TextDecoder().decode(bytes), truncated }
}
