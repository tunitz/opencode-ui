# Files returned as chat attachments

* **Date:** 2026-11-02
* **Status:** Concept review; not approved for implementation

## Overview

When a user asks the assistant to give them a file, the response should include an attachment in the conversation, not just a hyperlink or path. This includes existing files such as `AGENTS.md`, files outside the project, and generated files such as website screenshots. The user does not want to perform an extra attach action for each file. If delivery fails, the conversation should say so.

This concerns files returned **to the user**, not files attached to a later prompt or uploaded to a model provider. A displayed attachment must not be described as sent to the model unless it actually was.

## Analysis

The current UI can show structured file outputs from tools as artifact cards. A local `file:` output does not automatically become a downloadable artifact, and the existing resolver accepts only specific tool-text provenance and files under configured roots. It does not safely turn an arbitrary path in assistant prose into a file. The project explicitly forbids bypassing file safety and artifact provenance checks.

The UI server and OpenCode engine can run on different hosts, so a path returned by the engine is not necessarily a path on the UI server. The design must identify the host and verify that the returned bytes belong to the specific requested file. The current UI has no separate browser login; changing the server into a general filesystem download endpoint would widen the authority of anyone who can reach it. An instruction in a chat message or tool output is not by itself a trustworthy server-side access control mechanism.

The design needs a structured way for the agent or a trusted tool to identify requested outputs, without inferring authorization from arbitrary assistant prose. It must retain origin and host checks, route allowlists, safe file handling, and honest errors. Local filesystem permissions, unavailable tools, safety policy, unsupported formats, and deployment topology can prevent delivery; the UI must not promise success in those cases. An explicit user request to allow outside-project files does not on its own establish a safe server-side provenance mechanism.

Reviewers also identified file replacement between validation and reading, ephemeral artifact IDs, potentially large files and image previews, and multiple files with the same name as cases to address. Some reviewers interpreted the request as uploading files to the model; that is explicitly out of scope.

## Goals vs. Non-Goals

* **In scope:** Automatically show requested existing and generated files as downloadable conversation attachments, including outside-project paths when safely supportable; support screenshots and other file types; distinguish successful delivery from a failure; preserve existing security boundaries and accessibility.
* **Out of scope:** Automatically adding returned files to the next user prompt, treating a Markdown path as authorization, enabling general anonymous host filesystem browsing, modifying the separate OpenCode backend, or requiring a manual attachment click for every successful request.

## Alternatives Weighed

* **Show Markdown links only:** rejected because it does not meet the user's request.
* **Ask the user to use the existing composer attachment button:** rejected because it attaches input to a prompt, not an assistant output to the conversation, and requires a manual step.
* **Turn every path in assistant prose into a downloadable file:** rejected because path text is untrusted and does not establish provenance or authority.
* **Widen artifact roots to the whole filesystem:** rejected because it would weaken the current safety boundary and expose unrelated host files.
* **Reuse structured tool file outputs and the existing artifact UI:** promising where the engine and tools actually provide the necessary provenance; gaps for local paths, remote engines, and arbitrary requested files still require design and verification.

## Key Decisions & Staging for Next Steps

1. The user's request is a natural-language request for an assistant response attachment, not a request to upload a file to a model.
2. Outside-project files are wanted; do not silently reduce the goal to project files or screenshots only.
3. Retain file safety and provenance checks; determine whether a compatible structured delivery mechanism can satisfy the goal without changing the separate engine. If not, document the limitation rather than claiming it works.
4. Review the pinned engine and tool contracts, current artifact resolver and renderer, local versus remote engine behavior, and relevant tests. Then prepare an implementation design and task plan for explicit owner approval before code changes.
5. Verify success and failure paths with safe synthetic fixtures, including requested project file, requested outside-project file, screenshot, missing file, path substitution, and inaccessible or remote-engine cases. Do not mutate live sessions without permission.
