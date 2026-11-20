import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AGENT_CONFIG_DEFAULT_ROUTE,
  AGENT_CONFIG_ROUTE,
  createAgentConfigService,
} from "../server/agent-config.ts"

const tempDir = await mkdtemp(join(tmpdir(), "opencode-agents-remote-"))
const configPath = join(tempDir, "opencode.jsonc")
const LOCAL_CONFIG = '{"agents":{"local-only":{"mode":"primary"}}}\n'
await writeFile(configPath, LOCAL_CONFIG, "utf8")

let isRemote = true
let agentFetchFails = false

const remoteAgents = [
  {
    id: "remote-agent",
    name: "Remote Agent",
    mode: "primary",
    description: "provided by the remote engine",
    hidden: false,
  },
  {
    id: "remote-sub",
    name: "Remote Sub",
    mode: "subagent",
    hidden: false,
  },
]

const mockFetch = async (url) => {
  const path = new URL(String(url)).pathname
  if (path === "/api/agent") {
    if (agentFetchFails) return new Response("boom", { status: 500 })
    return Response.json(remoteAgents)
  }
  if (path === "/api/project") return Response.json([])
  if (path === "/api/config") return Response.json([])
  if (path === "/api/model") return Response.json([])
  return new Response("not found", { status: 404 })
}

const service = createAgentConfigService({
  env: { OPENCODE_CONFIG_DIR: tempDir },
  home: tempDir,
  fetch: mockFetch,
  getTarget: () => ({
    opencodeBaseUrl: "http://remote",
    authorization: "",
    isRemote,
    name: isRemote ? "remote" : "local",
  }),
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  isRemote = true
  agentFetchFails = false
})

function catalogRequest() {
  return new Request(`http://local${AGENT_CONFIG_ROUTE}?scope=global`)
}

function jsonRequest(method, path, body) {
  return new Request(`http://local${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

test("remote catalog contains only the remote engine's agents, all read-only", async () => {
  const response = await service.handleRequest(catalogRequest())
  expect(response.status).toBe(200)
  const catalog = await response.json()
  expect(catalog.remote).toBe(true)
  expect(catalog.sourceLabel).toBe("Remote engine agents")
  const ids = catalog.agents.map((entry) => entry.id)
  expect(ids).toContain("remote-agent")
  expect(ids).toContain("remote-sub")
  expect(ids).not.toContain("local-only")
  expect(ids).toEqual(["remote-agent", "remote-sub"])
  for (const entry of catalog.agents) {
    expect(entry.readonly).toBe(true)
    expect(entry.source).toBeNull()
    expect(entry.target).toBeNull()
    expect(entry.permissionsReadOnly).toBe(true)
  }
  expect(catalog.warnings.join(" ")).toContain("read-only")
})

test("a failed remote agent fetch returns an error instead of local agents", async () => {
  agentFetchFails = true
  const response = await service.handleRequest(catalogRequest())
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(response.status).not.toBe(200)
  const body = await response.json()
  expect(body.error.code).toBe("remote_catalog_unavailable")
  expect(body.error.message).toContain("remote engine")
})

test("remote mutations are rejected and local files are untouched", async () => {
  const before = await readFile(configPath, "utf8")

  const put = await service.handleRequest(
    jsonRequest("PUT", AGENT_CONFIG_ROUTE, {
      scope: "global",
      projectID: null,
      agentID: "local-only",
      target: { kind: "jsonc", relativePath: "opencode.jsonc" },
      expectedHash: null,
      patch: { description: "hacked" },
    })
  )
  expect(put.status).toBe(403)
  expect((await put.json()).error.code).toBe("remote_read_only")

  const del = await service.handleRequest(
    jsonRequest("DELETE", AGENT_CONFIG_ROUTE, {
      scope: "global",
      projectID: null,
      agentID: "local-only",
      expectedHash: null,
    })
  )
  expect(del.status).toBe(403)
  expect((await del.json()).error.code).toBe("remote_read_only")

  const defaultPut = await service.handleRequest(
    jsonRequest("PUT", AGENT_CONFIG_DEFAULT_ROUTE, {
      scope: "global",
      agentID: "remote-agent",
    })
  )
  expect(defaultPut.status).toBe(403)
  expect((await defaultPut.json()).error.code).toBe("remote_read_only")

  expect(await readFile(configPath, "utf8")).toBe(before)
})

test("local connections still merge file-defined agents", async () => {
  isRemote = false
  const response = await service.handleRequest(catalogRequest())
  expect(response.status).toBe(200)
  const catalog = await response.json()
  expect(catalog.remote).toBeUndefined()
  const ids = catalog.agents.map((entry) => entry.id)
  expect(ids).toContain("local-only")
})
