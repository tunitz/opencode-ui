import { expect, test } from "bun:test"
import { createEditor, $createTextNode, $getRoot } from "lexical"
import { $editReferenceAsText, $insertComposerPlainText, $loadComposerText, ReferenceNode, registerReferenceTransform } from "../src/components/composer-editor"

test("Lexical references preserve exact raw tokens, text and newlines", () => {
  const editor = createEditor({ namespace: "test", nodes: [ReferenceNode], onError: (error) => { throw error } })
  const text = 'hello\n@"src/a\\u0020b.ts" and @"../unsafe" @"unterminated'
  editor.update(() => $loadComposerText(text), { discrete: true })
  editor.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe(text)
    const nodes = $getRoot().getFirstChild().getChildren()
    expect(nodes.filter((node) => node instanceof ReferenceNode)).toHaveLength(1)
    expect(nodes.find((node) => node instanceof ReferenceNode).getTextContent()).toBe('@"src/a\\u0020b.ts"')
  })
})

test("plain text insertion preserves CRLF, whitespace and reference bytes", () => {
  const editor = createEditor({ namespace: "test", nodes: [ReferenceNode], onError: (error) => { throw error } })
  const unregister = registerReferenceTransform(editor)
  const pasted = '  first\r\n@"src/a\\u0020b.ts"\r\nlast  '
  editor.update(() => {
    $loadComposerText("before after")
    $getRoot().getFirstChild().getFirstChild().select(7, 7)
    $insertComposerPlainText(pasted)
  }, { discrete: true })
  editor.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe(`before ${pasted}after`)
    expect($getRoot().getFirstChild().getChildren().filter((node) => node instanceof ReferenceNode)).toHaveLength(1)
  })
  unregister()
})

test("duplicate references remain distinct atomic nodes", () => {
  const editor = createEditor({ namespace: "test", nodes: [ReferenceNode], onError: (error) => { throw error } })
  const text = '@"src/a.ts" @"src/a.ts"'
  editor.update(() => $loadComposerText(text), { discrete: true })
  editor.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe(text)
    expect($getRoot().getFirstChild().getChildren().filter((node) => node instanceof ReferenceNode)).toHaveLength(2)
  })
})

test("editing a reference between text stays editable through normalization and splits", () => {
  const editor = createEditor({ namespace: "test", nodes: [ReferenceNode], onError: (error) => { throw error } })
  const unregister = registerReferenceTransform(editor)
  const original = 'Read @"src/alpha.ts" please'
  editor.update(() => $loadComposerText(original), { discrete: true })
  editor.update(() => {
    const chip = $getRoot().getFirstChild().getChildren().find((node) => node instanceof ReferenceNode)
    $editReferenceAsText(chip)
  }, { discrete: true })
  editor.getEditorState().read(() => {
    const children = $getRoot().getFirstChild().getChildren()
    expect($getRoot().getTextContent()).toBe(original)
    expect(children.some((node) => node instanceof ReferenceNode)).toBe(false)
    expect(children.find((node) => node.getTextContent() === '@"src/alpha.ts"').isUnmergeable()).toBe(true)
  })
  editor.update(() => {
    const paragraph = $getRoot().getFirstChild()
    const edited = paragraph.getChildren().find((node) => node.getTextContent() === '@"src/alpha.ts"')
    edited.setTextContent(`note ${edited.getTextContent()}`)
    edited.splitText(5)
    paragraph.append($createTextNode(' @"src/new.ts"'))
  }, { discrete: true })
  editor.getEditorState().read(() => {
    const children = $getRoot().getFirstChild().getChildren()
    expect($getRoot().getTextContent()).toBe('Read note @"src/alpha.ts" please @"src/new.ts"')
    expect(children.filter((node) => node instanceof ReferenceNode).map((node) => node.getTextContent())).toEqual(['@"src/new.ts"'])
  })
  unregister()
})
