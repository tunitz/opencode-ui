import { useMemo, type ReactNode } from "react"
import { HeartPulseIcon } from "lucide-react"
import { Card } from "@openuidev/react-ui/Card"
import { CardHeader } from "@openuidev/react-ui/CardHeader"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@openuidev/react-ui/Table"
import "@openuidev/react-ui/styles/card.css"
import "@openuidev/react-ui/styles/cardHeader.css"
import "@openuidev/react-ui/styles/table.css"

import {
  healthvaultToolView,
  type HealthvaultBlock,
  type HealthvaultContentView,
  type HealthvaultStatsBlock,
  type HealthvaultTableBlock,
  type HealthvaultTextBlock,
} from "@/lib/healthvault-tool-view"

function StatsBlock({ block }: { block: HealthvaultStatsBlock }) {
  if (block.items.length === 0) return null
  return (
    <section className="min-w-0" aria-label={block.title}>
      <h4 className="mb-1 text-xs font-medium text-muted-foreground">
        {block.title}
      </h4>
      <dl className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-3">
        {block.items.map((item, index) => (
          <div
            key={`${item.label}-${index}`}
            className="min-w-0 rounded-lg border border-border/70 bg-background/50 px-2 py-1.5"
          >
            <dt className="truncate text-[11px] text-muted-foreground">
              {item.label}
            </dt>
            <dd
              className="truncate text-sm font-medium tabular-nums"
              title={item.value}
              dir="auto"
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function TableBlockView({ block }: { block: HealthvaultTableBlock }) {
  return (
    <section className="min-w-0" aria-label={block.caption}>
      <h4 className="mb-1 text-xs font-medium text-muted-foreground">
        {block.caption}
      </h4>
      <div className="openui-table-scope min-w-0 max-w-full">
        <Table
          aria-label={block.caption}
          containerClassName="openui-markdown-table"
          style={
            block.columns.length > 3
              ? { minWidth: `${block.columns.length * 7}rem` }
              : undefined
          }
        >
          <TableHeader>
            <TableRow>
              {block.columns.map((column) => (
                <TableHead key={column} scope="col">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {block.columns.map((column, columnIndex) => (
                  <TableCell key={`${column}-${columnIndex}`} dir="auto">
                    {row[columnIndex] ?? ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {block.moreRows > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {block.moreRows} more {block.moreRows === 1 ? "row" : "rows"}
        </p>
      ) : null}
    </section>
  )
}

function TextBlockView({ block }: { block: HealthvaultTextBlock }) {
  return (
    <p className="min-w-0 text-xs text-muted-foreground break-words" dir="auto">
      {block.text}
    </p>
  )
}

function Block({ block }: { block: HealthvaultBlock }) {
  switch (block.kind) {
    case "stats":
      return <StatsBlock block={block} />
    case "table":
      return <TableBlockView block={block} />
    case "text":
      return <TextBlockView block={block} />
  }
}

function HealthvaultView({ view }: { view: HealthvaultContentView }) {
  return (
    <div className="mt-2 min-w-0" data-healthvault-tool={view.tool}>
      <Card variant="sunk" width="full" className="openui-rich-card min-w-0">
        <CardHeader
          icon={<HeartPulseIcon aria-hidden="true" className="size-4" />}
          title={
            <span className="block min-w-0 truncate" dir="auto">
              {view.title}
            </span>
          }
          subtitle={
            <span className="block min-w-0 break-words" dir="auto">
              {view.summary}
            </span>
          }
        />
        <div className="min-w-0 space-y-3">
          {view.blocks.map((block, index) => (
            <Block key={`${block.kind}-${index}`} block={block} />
          ))}
        </div>
      </Card>
    </div>
  )
}

/**
 * Renders a parsed HealthVault result. Parse errors, unknown shapes and error
 * statuses fall back to `fallback` (the caller's raw Output detail).
 */
export function HealthvaultToolDetails({
  name,
  output,
  status,
  fallback,
}: {
  name: string | null
  output?: string
  status: "running" | "completed" | "error"
  fallback?: ReactNode
}) {
  const view = useMemo(
    () => healthvaultToolView(name, output, status),
    [name, output, status]
  )
  if (view.kind === "fallback") return <>{fallback ?? null}</>
  return <HealthvaultView view={view} />
}
