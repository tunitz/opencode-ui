import { BellIcon, BellOffIcon, LoaderCircleIcon, SmartphoneIcon } from "lucide-react"
import { useState } from "react"

import { useNotifications } from "@/components/notifications-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { HelpDisclosure } from "@/components/ui/help-disclosure"
import { ScrollArea } from "@/components/ui/scroll-area"

function Toggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled ? "true" : undefined}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      </FieldContent>
      <label htmlFor={id} className="flex size-11 shrink-0 items-center justify-center">
        <Checkbox
          id={id}
          aria-label={label}
          aria-describedby={description ? `${id}-description` : undefined}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onChange(value === true)}
        />
      </label>
    </Field>
  )
}

export function NotificationsSettings() {
  const [confirmClear, setConfirmClear] = useState(false)
  const {
    support,
    permission,
    ready,
    enabled,
    pushEnabled,
    preferences,
    sessions,
    busy,
    error,
    enablePush,
    enableInApp,
    disable,
    updatePreferences,
    clearSessions,
    sendTest,
    refresh,
  } = useNotifications()

  const unavailable = !support.secure || (support.ios && !support.standalone)
  const pushUnavailableReason = !support.secure
    ? "Notifications require the private HTTPS address."
    : support.ios && !support.standalone
      ? "On iPhone, open OpenCode UI from its Home Screen icon (not a Safari tab) before enabling notifications."
      : !support.supported
        ? "This browser does not expose Web Push. In-app alerts can still work while OpenCode UI is open."
        : permission === "denied"
          ? "Notifications are blocked. Allow them in browser/OS settings; the app cannot force permission. In-app alerts can still work while open."
          : null

  if (!ready) {
    return (
      <div className="space-y-3 px-1 pb-2" aria-live="polite">
        {error ? (
          <>
            <p role="alert" className="text-sm text-destructive break-words">{error}</p>
            <Button type="button" variant="outline" className="h-11" onClick={() => void refresh()}>Retry</Button>
          </>
        ) : <p className="text-sm text-muted-foreground">Loading notification settings…</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4 px-1 pb-2">
      {pushUnavailableReason ? (
        <div className="flex gap-2 rounded-lg border border-border bg-background/60 p-3 text-[12px] leading-5 text-muted-foreground">
          <SmartphoneIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{pushUnavailableReason}</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/40 px-3 py-2">
          <p role="alert" className="text-xs break-words text-destructive">{error}</p>
          <Button type="button" variant="outline" className="mt-2 h-11" disabled={busy} onClick={() => void refresh()}>
            Reload settings
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!pushEnabled && support.supported && permission !== "denied" && (!support.ios || support.standalone) ? (
          <Button type="button" className="h-11 px-4" disabled={busy || unavailable} onClick={() => void enablePush()}>
            {busy ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <BellIcon aria-hidden="true" className="size-4" />}
            Enable device notifications
          </Button>
        ) : null}
        {!enabled ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={busy || !ready}
              onClick={() => void enableInApp()}
            >
              <BellIcon aria-hidden="true" className="size-4" />
              Enable in-app while open
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={() => void disable()}>
            {busy ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : <BellOffIcon aria-hidden="true" className="size-4" />}
            Turn off notifications
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4"
          disabled={!enabled || busy}
          onClick={() => void sendTest()}
        >
          Test notification
        </Button>
      </div>

      <FieldGroup className="gap-3">
        <Toggle
          id="notify-completion"
          label="Response completion"
          description="When a watched session finishes successfully."
          disabled={busy}
          checked={preferences.completion}
          onChange={(checked) => void updatePreferences({ completion: checked })}
        />
        <Toggle
          id="notify-attention"
          label="Needs attention"
          description="When a watched session requests permission or a question."
          disabled={busy}
          checked={preferences.needsAttention}
          onChange={(checked) => void updatePreferences({ needsAttention: checked })}
        />
        <Toggle
          id="notify-failure"
          label="Failures"
          description="When a watched session fails. User-requested stops are not failures."
          disabled={busy}
          checked={preferences.failure}
          onChange={(checked) => void updatePreferences({ failure: checked })}
        />
        <Toggle
          id="notify-in-app"
          label="In-app alerts while open"
          description="Shows the alert inside the app instead of a device notification while this page is visible."
          disabled={busy}
          checked={preferences.inApp}
          onChange={(checked) => void updatePreferences({ inApp: checked })}
        />
        <Toggle
          id="notify-title"
          label="Include session name on lock screen"
          description="Off by default for privacy; uses only the session title, never prompt or tool content."
          disabled={busy}
          checked={preferences.includeSessionTitle}
          onChange={(checked) => void updatePreferences({ includeSessionTitle: checked })}
        />
        <Toggle
          id="notify-sound"
          label="Notification sound"
          description="Best-effort; OS/browser notification settings may override this."
          disabled={busy}
          checked={preferences.sound}
          onChange={(checked) => void updatePreferences({ sound: checked })}
        />
      </FieldGroup>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium">Watched sessions</p>
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{sessions.length} of 50</span>
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-2 text-xs"
              aria-label="Clear watched sessions"
              disabled={sessions.length === 0 || busy}
              onClick={() => setConfirmClear(true)}
            >
              Clear
            </Button>
          </span>
        </div>
        {confirmClear ? (
          <div className="rounded-lg border border-border p-3" role="group" aria-label="Confirm clearing watched sessions">
            <p className="text-sm">Clear all watched sessions? You will stop receiving their alerts until you open them again.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => { setConfirmClear(false); void clearSessions() }}>Clear sessions</Button>
              <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}
        <p className="text-[11px] leading-5 text-muted-foreground">
          Only sessions you open, create, or send from are watched. Unused sessions expire after 30 days; other sessions are never notified.
        </p>
        {sessions.length > 0 ? (
          <ScrollArea viewportClassName="max-h-36" className="rounded-lg border border-border">
            <ul className="divide-y divide-border">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-center gap-2 px-3 py-2 text-[12px]">
                  <span className="min-w-0 truncate">{session.title?.trim() || "Untitled session"}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground">
            No sessions watched yet. Open a session after enabling notifications.
          </p>
        )}
      </div>

      <HelpDisclosure label="Delivery & privacy details">
        <p>
          Lock-screen text is generic by default. Optional session names never include prompt or tool content.
        </p>
        <p>
          Push delivery and OS focus behavior are best-effort, not guaranteed.
        </p>
      </HelpDisclosure>
    </div>
  )
}
