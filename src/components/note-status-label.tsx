import {
  ArchiveIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleSlashIcon,
  CircleXIcon,
  ClockIcon,
  LightbulbIcon,
} from "lucide-react"

import type { NoteStatus } from "@/components/notes-panel"

const statusStyles: Record<
  NoteStatus,
  { label: string; icon: typeof CircleIcon; className: string }
> = {
  idea: {
    label: "Idea",
    icon: LightbulbIcon,
    className: "text-violet-600 dark:text-violet-400",
  },
  todo: {
    label: "To do",
    icon: CircleIcon,
    className: "text-amber-600 dark:text-amber-400",
  },
  "in-progress": {
    label: "In progress",
    icon: ClockIcon,
    className: "text-sky-600 dark:text-sky-400",
  },
  blocked: {
    label: "Blocked",
    icon: CircleSlashIcon,
    className: "text-rose-600 dark:text-rose-400",
  },
  finished: {
    label: "Finished",
    icon: CircleCheckIcon,
    className: "text-emerald-600 dark:text-emerald-400",
  },
  cancelled: {
    label: "Cancelled",
    icon: CircleXIcon,
    className: "text-slate-600 dark:text-slate-400",
  },
  archived: {
    label: "Archived",
    icon: ArchiveIcon,
    className: "text-stone-600 dark:text-stone-400",
  },
}

/** Status never relies on color alone: every label pairs an icon with text. */
export function NoteStatusLabel({
  status,
  className = "",
}: {
  status: NoteStatus
  className?: string
}) {
  const style = statusStyles[status] ?? statusStyles.todo
  const Icon = style.icon
  return (
    <span
      role="img"
      aria-label={`Status: ${style.label}`}
      className={`inline-flex items-center gap-1 text-xs font-medium ${style.className} ${className}`}
      data-note-status={status}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span aria-hidden="true">{style.label}</span>
    </span>
  )
}
