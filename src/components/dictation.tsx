import { useEffect, useId, useRef, useState } from "react"
import { MicIcon, MicOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type Result = { isFinal: boolean; 0: { transcript: string } }
type Recognition = {
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { resultIndex: number; results: ArrayLike<Result> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionConstructor = new () => Recognition

const PRIVACY =
  "Speech recognition is provided by your browser and may send audio to its service. Text is editable and never sent automatically."

export function Dictation({
  enabled,
  onText,
  onError,
}: {
  enabled: boolean
  onText: (text: string) => void
  onError: (message: string | null) => void
}) {
  const [listening, setListening] = useState(false)
  const privacyId = useId()
  const recognition = useRef<Recognition | null>(null)
  const latest = useRef({ onText, onError })
  useEffect(() => {
    latest.current = { onText, onError }
  }, [onText, onError])
  useEffect(
    () => () => {
      const current = recognition.current
      recognition.current = null
      if (current) {
        current.onresult = null
        current.onerror = null
        current.onend = null
        current.abort()
      }
    },
    []
  )
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition

  function toggle() {
    if (recognition.current) {
      recognition.current.stop()
      return
    }
    if (!Constructor) return
    try {
      const current = new Constructor()
      recognition.current = current
      current.continuous = true
      current.interimResults = false
      current.onresult = (event) => {
        if (recognition.current !== current) return
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal && result[0]?.transcript)
            latest.current.onText(result[0].transcript)
        }
      }
      current.onerror = (event) => {
        latest.current.onError(
          `Dictation failed (${event.error}). Check microphone permission and try again.`
        )
      }
      current.onend = () => {
        if (recognition.current === current) {
          recognition.current = null
          setListening(false)
        }
      }
      current.start()
      setListening(true)
      latest.current.onError(null)
    } catch {
      recognition.current = null
      setListening(false)
      latest.current.onError(
        "Could not start dictation. Check microphone permission and try again."
      )
    }
  }

  if (!Constructor) return null

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="size-11 shrink-0 rounded-full text-foreground"
              disabled={!enabled}
              aria-label={listening ? "Stop dictation" : "Dictate"}
              aria-pressed={listening}
              aria-describedby={privacyId}
              onClick={toggle}
            />
          }
        >
          {listening ? (
            <MicOffIcon aria-hidden="true" className="size-5" />
          ) : (
            <MicIcon aria-hidden="true" className="size-5" />
          )}
        </TooltipTrigger>
        <TooltipContent side="top">{PRIVACY}</TooltipContent>
      </Tooltip>
      <span id={privacyId} className="sr-only">
        {PRIVACY}
      </span>
    </>
  )
}
