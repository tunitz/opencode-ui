import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const settings = await readFile(
  "src/components/model-settings.tsx",
  "utf8"
)
const controller = await readFile("src/lib/use-opencode.ts", "utf8")

test("composer agent selection calls switchAgent without switching the model", () => {
  const handler = settings.slice(
    settings.indexOf("async function handleAgentChange"),
    settings.indexOf("async function handleModelChange")
  )
  expect(handler).toContain("await nav.switchAgent(next)")
  expect(handler).not.toContain("switchModel")
  expect(handler).not.toContain("switchAgentWithDefaults")
  expect(settings).toContain("nav.switchModel(buildModelRef(info, nextVariant))")
  expect(settings).toContain(
    "buildModelRef(selectedModelInfo, next === DEFAULT_VARIANT ? null : next)"
  )
})

test("the controller has no combined agent+model switch helper", () => {
  expect(controller).not.toContain("switchAgentWithDefaults")
  const switchAgent = controller.slice(
    controller.indexOf("const switchAgent = useCallback"),
    controller.indexOf("const switchModel = useCallback")
  )
  expect(switchAgent).toContain("openCode.session.switchAgent({ sessionID, agent: agentID })")
  expect(switchAgent).not.toContain("switchModel")
  const switchModel = controller.slice(
    controller.indexOf("const switchModel = useCallback"),
    controller.indexOf("const replyPermission = useCallback")
  )
  expect(switchModel).toContain("openCode.session.switchModel({ sessionID, model })")
})

test("session creation sends one request with the chosen location, agent and model", () => {
  const create = controller.slice(
    controller.indexOf("const createSession = useCallback"),
    controller.indexOf("const renameSession = useCallback")
  )
  expect(create.match(/openCode\.session\.create\(/g)).toHaveLength(1)
  expect(create).toContain("location: { directory: targetDirectory }")
  expect(create).toContain("model: selectedModel")
  // No fallback model is synthesized if the caller has no selection.
  expect(create).toContain("if (!selectedModel)")
})
