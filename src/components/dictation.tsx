import { useEffect, useRef, useState } from "react"
import { MicIcon, MicOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

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

export function Dictation({ enabled, onText }: { enabled: boolean; onText: (text: string) => void }) {
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const latest = useRef(onText)
  useEffect(() => { latest.current = onText }, [onText])
  useEffect(() => () => {
    const current = recognition.current
    recognition.current = null
    if (current) { current.onresult = null; current.onerror = null; current.onend = null; current.abort() }
  }, [])
  const browser = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition
  function toggle() {
    if (recognition.current) { recognition.current.stop(); return }
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
          if (result.isFinal && result[0]?.transcript) latest.current(result[0].transcript)
        }
      }
      current.onerror = (event) => { setMessage(`Dictation failed (${event.error}). Check microphone permission and try again.`) }
      current.onend = () => { if (recognition.current === current) { recognition.current = null; setListening(false) } }
      current.start()
      setListening(true)
      setMessage(null)
    } catch {
      recognition.current = null
      setListening(false)
      setMessage("Could not start dictation. Check microphone permission and try again.")
    }
  }
  return <div className="px-3 pb-2">
    <div className="flex items-center gap-2">
      <Button type="button" variant="ghost" className="min-h-11" disabled={!enabled || !Constructor} onClick={toggle} aria-pressed={listening}>
        {listening ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
        {listening ? "Stop dictation" : "Dictate"}
      </Button>
      <p className="text-xs text-muted-foreground">{Constructor ? "Speech recognition is provided by your browser and may send audio to its service. Text is editable and never sent automatically." : "Dictation is unavailable in this browser. You can use your device keyboard's dictation or type instead."}</p>
    </div>
    {message ? <p role="alert" className="text-xs text-destructive">{message}</p> : null}
  </div>
}
