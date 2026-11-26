import { NOTE_STATUSES } from "../types.js"

export interface NotesPromptArgument {
  readonly name: string
  readonly description: string
  readonly required: boolean
}

export interface NotesPromptDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly arguments: readonly NotesPromptArgument[]
  render(
    args: Readonly<Record<string, string | undefined>>,
    defaultDirectory: string
  ): string
}

function localDay(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function optionalArgument(
  args: Readonly<Record<string, string | undefined>>,
  name: string
): string | undefined {
  const value = args[name]?.trim()
  return value ? value : undefined
}

export const NOTES_PROMPTS: readonly NotesPromptDefinition[] = [
  {
    name: "notes:capture",
    title: "Capture this conversation as a note",
    description:
      "Distill the current conversation into a durable note with decisions, evidence, and next steps.",
    arguments: [
      { name: "title", description: "Note title", required: false },
      { name: "space", description: "Target space name or ID", required: false },
      { name: "status", description: "Initial status", required: false },
    ],
    render(args, defaultDirectory) {
      const title = optionalArgument(args, "title") ?? "<short, specific title>"
      const space = optionalArgument(args, "space") ?? "<Global or project space>"
      const requestedStatus = optionalArgument(args, "status")
      const status =
        requestedStatus &&
        (NOTE_STATUSES as readonly string[]).includes(requestedStatus)
          ? requestedStatus
          : "todo"
      return [
        "Capture the current conversation as a durable note.",
        "",
        "1. Call notes_search with the project directory to check for an existing related note.",
        `2. Call notes_spaces with directory "${defaultDirectory}" and resolve the target space "${space}". Create it with notes_create_space only if it does not exist.`,
        "3. Call notes_create with:",
        `   - title: ${title}`,
        `   - spaceID: the resolved space ID`,
        `   - status: ${status}`,
        "   - body: a distilled summary, not a transcript. Include the goal, decisions and",
        "     rationale, files and symbols touched, commands run, verification evidence,",
        "     open questions, and concrete next steps.",
        "4. If the note records work that is already underway, set status to in-progress.",
        "",
        "Do not include secrets, credentials, or private tokens in the note.",
      ].join("\n")
    },
  },
  {
    name: "notes:daily",
    title: "Write today's daily log",
    description:
      "Find or create the Daily space and today's note, then append a dated summary section.",
    arguments: [
      { name: "date", description: "Local day (YYYY-MM-DD)", required: false },
    ],
    render(args) {
      const date = optionalArgument(args, "date") ?? localDay()
      return [
        `Maintain the daily log for ${date}.`,
        "",
        '1. Call notes_spaces without a directory and look for a space named "Daily" with projectDir null. If it is missing, call notes_create_space with name "Daily" and projectDir null.',
        `2. Call notes_search for "${date}" in that space and look for a note titled exactly "${date}". If it is missing, call notes_create with title "${date}", that space, status "in-progress", and a short intro body.`,
        "3. Append a new section to the body:",
        "",
        `   ## ${date} — <short heading>`,
        "",
        "   Write what changed, decisions made and why, evidence (commands, tests, commit",
        "   references), and anything left open. Keep it factual; do not restate the whole",
        "   conversation.",
        "",
        "4. Save with notes_update and the expectedRevision you just read.",
        "5. Set the note status to finished only when the day is closed and its claims are verified.",
      ].join("\n")
    },
  },
  {
    name: "notes:review",
    title: "Reconcile project note statuses",
    description:
      "Review pinned and active notes for the project, verify their status against reality, and record evidence.",
    arguments: [
      {
        name: "directory",
        description: "Canonical project directory",
        required: false,
      },
    ],
    render(args, defaultDirectory) {
      const directory = optionalArgument(args, "directory") ?? defaultDirectory
      return [
        `Review the notes for the project at "${directory}".`,
        "",
        "1. Call notes_list with directory set and pinned true to find pinned notes;",
        '   then call it again with statuses ["in-progress", "blocked"].',
        "2. For each note, verify its claims against the repository and the evidence recorded in",
        "   its body. Do not trust a status at face value.",
        "3. Correct stale statuses with notes_update and the expectedRevision you read:",
        '   - idea/todo: not started',
        '   - in-progress: actively being worked',
        '   - blocked: waiting on a decision or dependency',
        '   - finished: verified, with evidence and commit references appended to the body',
        '   - cancelled/archived: intentionally not completed; done-category is terminal by convention',
        "4. Before setting finished, append the verification evidence (commands, outcomes, commit)",
        "   to the note body in the same update.",
        "5. Report a short summary of what changed and why.",
      ].join("\n")
    },
  },
]
