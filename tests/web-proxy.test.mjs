import { describe, expect, test } from "bun:test"
import { proxyEngineRequest } from "../server/web-proxy.ts"
import { gzipSync } from "node:zlib"

describe("engine web proxy", () => {
  test("uses fixed target, server credential, and strips CORS and hop headers", async () => {
    const request = new Request("http://browser.test/api/event?cursor=1", {
      headers: { host: "browser.test", authorization: "untrusted", connection: "x-private", "x-private": "remove" },
    })
    const response = await proxyEngineRequest(request, {
      target: "http://127.0.0.1:1234", authorization: "server credential",
      fetch: async (url, init) => {
        expect(url.href).toBe("http://127.0.0.1:1234/api/event?cursor=1")
        expect(init.headers.get("host")).toBe("browser.test")
        expect(init.headers.get("authorization")).toBe("server credential")
        expect(init.headers.has("x-private")).toBe(false)
        return new Response("data: ok\n\n", { headers: { "access-control-allow-origin": "*", "content-type": "text/event-stream" } })
      },
    })
    expect(response.headers.has("access-control-allow-origin")).toBe(false)
    expect(await response.text()).toBe("data: ok\n\n")
  })

  test("returns a gateway error without exposing upstream errors", async () => {
    const response = await proxyEngineRequest(new Request("http://browser.test/api/info"), {
      target: "http://127.0.0.1:1234", fetch: async () => { throw new Error("sensitive") },
    })
    expect(response.status).toBe(502)
    expect(await response.text()).toBe("Upstream unavailable\n")
  })

  test("preserves compressed bytes and response headers", async () => {
    const compressed = gzipSync("engine response")
    const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(compressed, {
      headers: { "content-encoding": "gzip", "content-length": String(compressed.length) },
    }) })
    try {
      const response = await proxyEngineRequest(new Request("http://browser.test/api/info"), {
        target: `http://127.0.0.1:${upstream.port}`,
      })
      expect(response.headers.get("content-encoding")).toBe("gzip")
      expect(response.headers.get("content-length")).toBe(String(compressed.length))
      expect(Buffer.from(await response.arrayBuffer())).toEqual(compressed)
    } finally {
      await upstream.stop(true)
    }
  })
})
