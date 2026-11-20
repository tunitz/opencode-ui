import { describe, expect, test } from "bun:test"
import { localLanHosts, resolveTrustedOrigins } from "../server/trusted-origins.ts"

const interfaces = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  enp3s0: [{ address: "192.168.31.10", family: "IPv4", internal: false }],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  tailscale0: [{ address: "100.67.153.70", family: "IPv4", internal: false }],
  wan0: [{ address: "203.0.113.5", family: "IPv4", internal: false }],
  wlan0: [{ address: "fd7a:115c::1", family: "IPv6", internal: false }],
}

describe("local LAN hosts", () => {
  test("keeps only non-internal private IPv4 addresses", () => {
    expect(localLanHosts(interfaces)).toEqual(["172.17.0.1", "192.168.31.10"])
  })
})

describe("trusted origin resolution", () => {
  test("auto-trusts local LAN addresses for a non-loopback bind", () => {
    const trust = resolveTrustedOrigins({
      hostname: "0.0.0.0",
      port: 5174,
      localHosts: ["192.168.31.10"],
    })
    expect(trust.allowedHosts).toContain("192.168.31.10")
    expect(trust.allowedOrigins).toContain("http://192.168.31.10:5174")
    expect(trust.allowedHosts).not.toContain("100.67.153.70")
  })

  test("derives the host from an explicit HTTPS origin", () => {
    const trust = resolveTrustedOrigins({
      hostname: "127.0.0.1",
      port: 5174,
      allowedOrigins: ["https://ui.example.test"],
    })
    expect(trust.allowedHosts).toContain("ui.example.test")
    expect(trust.allowedOrigins).toContain("https://ui.example.test")
  })

  test("derives a plain HTTP origin from an explicit non-loopback host", () => {
    const trust = resolveTrustedOrigins({
      hostname: "0.0.0.0",
      port: 1234,
      allowedHosts: ["192.168.31.10"],
    })
    expect(trust.allowedOrigins).toContain("http://192.168.31.10:1234")
    expect(trust.allowedHosts).toContain("192.168.31.10")
  })

  test("explicit values replace automatic LAN trust", () => {
    const trust = resolveTrustedOrigins({
      hostname: "0.0.0.0",
      port: 5174,
      allowedOrigins: ["https://ui.example.test"],
      localHosts: ["192.168.31.10"],
    })
    expect(trust.allowedHosts).not.toContain("192.168.31.10")
    expect(trust.allowedOrigins).not.toContain("http://192.168.31.10:5174")
  })

  test("keeps loopback trust on every path", () => {
    const trust = resolveTrustedOrigins({ port: 5174 })
    expect(trust.allowedHosts).toEqual(["127.0.0.1", "localhost", "[::1]"])
    expect(trust.allowedOrigins).toEqual([
      "http://127.0.0.1:5174",
      "http://localhost:5174",
      "http://[::1]:5174",
    ])
  })
})
