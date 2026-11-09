const HOP_BY_HOP = [
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
  "trailer", "transfer-encoding", "upgrade",
]

function stripHopByHop(headers: Headers) {
  for (const name of (headers.get("connection") ?? "").split(",")) {
    if (name.trim()) headers.delete(name.trim())
  }
  for (const name of HOP_BY_HOP) headers.delete(name)
}

/** Proxy only to the configured engine. Never forward browser authorization. */
export async function proxyEngineRequest(
  request: Request,
  options: { target: string; authorization?: string; fetch?: typeof fetch }
): Promise<Response> {
  const incoming = new URL(request.url)
  const target = new URL(options.target)
  target.pathname = incoming.pathname
  target.search = incoming.search
  const headers = new Headers(request.headers)
  stripHopByHop(headers)
  headers.delete("authorization")
  if (options.authorization) headers.set("authorization", options.authorization)
  try {
    const upstream = await (options.fetch ?? fetch)(target, {
      method: request.method,
      headers,
      body: request.body,
      signal: request.signal,
      redirect: "manual",
      // Preserve compressed bytes and never send engine credentials to an environment proxy.
      decompress: false,
      proxy: false,
      // Bun supports streaming request bodies; the option is required by Fetch implementations.
      duplex: "half",
    } as RequestInit)
    const responseHeaders = new Headers(upstream.headers)
    stripHopByHop(responseHeaders)
    for (const name of [...responseHeaders.keys()]) {
      if (name.toLowerCase().startsWith("access-control-")) responseHeaders.delete(name)
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch {
    return new Response("Upstream unavailable\n", { status: 502 })
  }
}
