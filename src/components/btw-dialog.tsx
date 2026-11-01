import { useEffect, useRef, useState } from "react"
import { Callout } from "@openuidev/react-ui/Callout"
import "@openuidev/react-ui/styles/callout.css"
import "./openui-selective.css"
import {
  ClipboardCopyIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
  XIcon,
} from "lucide-react"

import { Markdown } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { buildBtwPrompt, canAskBtw } from "@/lib/btw"
import { errorMessage, openCode } from "@/lib/opencode"
import { useIsDesktop } from "@/lib/use-is-desktop"
import type { OpenCodeController } from "@/lib/use-opencode"

type Props = {
  nav: OpenCodeController
  initialQuestion: string
  onClose: () => void
  onResult: (message: string, ok?: boolean) => void
}

export function BtwDialog({
  nav,
  initialQuestion,
  onClose,
  onResult,
}: Props) {
  const isDesktop = useIsDesktop()
  const session = nav.activeSession
  const [question, setQuestion] = useState(initialQuestion)
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const initialSessionID = useRef(session?.id ?? null)

  useEffect(() => {
    if (!session || session.id !== initialSessionID.current) {
      abortRef.current?.abort()
      onClose()
    }
  }, [onClose, session])

  if (!session) return null
  const model = session.model
  const modelLabel = model
    ? `${model.providerID}/${model.id}${model.variant ? ` · ${model.variant}` : ""}`
    : "No selected model"
  const trimmed = question.trim()

  function close() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
      onResult(
        "Side question closed before an answer. The server may still finish the request; no automatic resend was started."
      )
    }
    onClose()
  }

  async function ask() {
    const prompt = buildBtwPrompt(question)
    if (!prompt || pending || !session) return
    if (!canAskBtw({ question, pending, hasModel: Boolean(model) })) {
      if (!model) setError("This session has no selected model.")
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setPending(true)
    setError(null)
    setCopied(false)
    try {
      const result = await openCode.session.generate(
        {
          sessionID: session.id,
          prompt,
        },
        { signal: controller.signal }
      )
      if (controller.signal.aborted) return
      setAnswer(result.text.trim())
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(errorMessage(failure))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setPending(false)
      }
    }
  }

  async function copy() {
    if (!answer) return
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable; select the answer text to copy.")
      }
      await navigator.clipboard.writeText(answer)
      setCopied(true)
      onResult("Copied the side answer.")
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <MessageCircleQuestionIcon aria-hidden="true" className="size-4" />
            Side question
          </h2>
          <p className="text-[12px] text-muted-foreground">
            One-shot answer from this session&apos;s context. It is not added to the conversation.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close side question"
          className="size-11 shrink-0 rounded-full p-0"
          onClick={close}
        >
          <XIcon aria-hidden="true" className="size-5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-muted-foreground">
            Asking sends a model request using this session&apos;s selected model ({modelLabel})
            and agent. Cost or rate limits may apply. No request starts until you press Ask.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="btw-question" className="text-[12px] font-medium">
              Question
            </label>
            <Textarea
              id="btw-question"
              aria-label="Side question"
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value)
                setError(null)
                setCopied(false)
              }}
              placeholder="Ask anything about the conversation so far…"
              className="min-h-28 resize-none text-base leading-6"
              autoFocus
              disabled={pending}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void ask()
                }
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Enter inserts a newline. Only Ask triggers the model. Raw text and quotes are sent
              unchanged.
            </p>
          </div>

          {answer !== null ? (
            <section
              aria-label="Side answer"
              aria-live="polite"
              className="rounded-lg border border-border bg-muted/20 p-3"
            >
              <p className="text-[11px] font-medium text-muted-foreground">Question</p>
              <p className="mt-1 text-[12px] whitespace-pre-wrap break-words">{trimmed}</p>
              <div className="mt-3 max-h-[42svh] overflow-y-auto">
                {answer ? (
                  <Markdown>{answer}</Markdown>
                ) : (
                  <p className="text-xs text-muted-foreground">No answer text returned.</p>
                )}
              </div>
            </section>
          ) : null}

          {pending ? (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              Asking the selected model…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs break-words text-destructive">
              {error}
            </p>
          ) : null}
          <Callout
            className="app-openui-warning"
            variant="warning"
            description="Closing while waiting cancels only this browser request. The server may still finish it; this client never resends automatically. The side answer is not written to durable session history."
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="outline" className="h-11 px-4" onClick={close}>
          Close
        </Button>
        {answer !== null ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            aria-label="Copy answer"
            onClick={() => void copy()}
          >
            <ClipboardCopyIcon aria-hidden="true" className="size-4" />
            {copied ? "Copied" : "Copy"}
          </Button>
        ) : null}
        <Button
          type="button"
          className="h-11 px-4"
          aria-label={answer !== null || error ? "Ask again" : "Ask"}
          onClick={() => void ask()}
          disabled={!canAskBtw({ question, pending, hasModel: Boolean(model) })}
          aria-busy={pending}
        >
          {pending ? (
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          ) : null}
          Ask
        </Button>
      </div>
    </div>
  )

  if (!isDesktop) {
    return (
      <Sheet open onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 bg-card p-0"
          style={{
            bottom:
              "calc(100dvh - var(--app-viewport-top, 0px) - var(--app-viewport-height, 100dvh))",
            maxHeight: "var(--app-viewport-height, 92svh)",
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Side question</SheetTitle>
            <SheetDescription>Ask a one-shot side question.</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85svh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Side question</DialogTitle>
          <DialogDescription>Ask a one-shot side question.</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}
