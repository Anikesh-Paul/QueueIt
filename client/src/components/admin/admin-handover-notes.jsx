import { useCallback, useEffect, useState } from "react";
import { Pin, PinOff, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ackHandoverNote, fetchHandoverNotes, patchHandoverNote, postHandoverNote, resolveHandoverNote } from "@/api";
import { useI18n } from "@/context/i18n-context";
import { formatCampusDateTime } from "@/lib/campus-time";
import {
  EXPIRY_PRESETS,
  NOTE_BODY_MAX,
  activeNotes,
  clampNoteBody,
  expiryPresetLabel,
  handoverExpiryHoursOf,
  noteState,
  sortNotes,
} from "@/lib/handover.js";
import { cn } from "@/lib/utils";

function scopeLabel(note, t) {
  return note.counterName ? note.counterName : t("handover.queueWide");
}

function NoteCard({ note, locale, t, busy, onPin, onFlag, onAck, onResolve }) {
  const state = noteState(note);
  const resolved = state === "resolved";
  const expired = state === "expired";
  return (
    <li
      data-testid="handover-note"
      data-state={state}
      data-pinned={note.pinned ? "true" : undefined}
      data-important={note.important ? "true" : undefined}
      className={cn(
        "rounded-md border px-3 py-3",
        note.pinned && !resolved ? "border-primary/40 bg-primary-muted/40" : "border-border bg-background",
        (resolved || expired) && "opacity-70"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {note.pinned ? (
              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary" data-testid="handover-pinned-badge">
                {t("handover.pinned")}
              </span>
            ) : null}
            {note.important ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-ink" data-testid="handover-important-badge">
                <AlertTriangle className="size-3" aria-hidden="true" />
                {t("handover.important")}
              </span>
            ) : null}
            {resolved ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-text-muted">{t("handover.resolved")}</span>
            ) : null}
            {expired && !resolved ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-text-muted">{t("handover.expired")}</span>
            ) : null}
            <span className="text-xs text-text-muted">{scopeLabel(note, t)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground" data-testid="handover-note-body">
            {note.body}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {note.author?.name ? t("handover.by", { name: note.author.name }) : null}
            {note.expiresAt && !resolved ? ` · ${t("handover.expires", { when: formatCampusDateTime(note.expiresAt, locale) })}` : null}
          </p>
        </div>
        {resolved ? null : (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onPin(note)} data-testid="handover-pin">
              {note.pinned ? <PinOff className="size-3.5" aria-hidden="true" /> : <Pin className="size-3.5" aria-hidden="true" />}
              {note.pinned ? t("handover.unpin") : t("handover.pin")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onFlag(note)} data-testid="handover-flag">
              {t("handover.important")}
            </Button>
            {!note.acknowledged ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAck(note)} data-testid="handover-ack">
                {t("handover.ack")}
              </Button>
            ) : (
              <span className="self-center text-xs text-text-muted" data-testid="handover-acked">
                {t("handover.acked")}
              </span>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onResolve(note)} data-testid="handover-resolve">
              <Check className="size-3.5" aria-hidden="true" />
              {t("handover.resolve")}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Staff console panel: leave, pin, acknowledge and resolve short handover notes.
 */
export function AdminHandoverNotes({ token, queueId, counters = [], defaultExpiryHours }) {
  const { t, locale } = useI18n();
  const [notes, setNotes] = useState([]);
  const [expiryHours, setExpiryHours] = useState(handoverExpiryHoursOf({ handoverExpiryHours: defaultExpiryHours }));
  const [body, setBody] = useState("");
  const [counterId, setCounterId] = useState("");
  const [important, setImportant] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState(handoverExpiryHoursOf({ handoverExpiryHours: defaultExpiryHours }));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const applyPayload = useCallback((data) => {
    if (!data) return;
    setNotes(sortNotes(data.notes || []));
    const hours = data.handover?.expiryHours;
    if (hours) {
      setExpiryHours(hours);
      setExpiresInHours((current) => (EXPIRY_PRESETS.includes(current) ? current : hours));
    }
  }, []);

  const load = useCallback(async () => {
    if (!token || !queueId) return;
    setLoading(true);
    setError("");
    try {
      applyPayload(await fetchHandoverNotes(token, queueId));
    } catch (err) {
      setError(err.message || t("handover.failed"));
    } finally {
      setLoading(false);
    }
  }, [token, queueId, applyPayload, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hours = handoverExpiryHoursOf({ handoverExpiryHours: defaultExpiryHours });
    if (defaultExpiryHours) {
      setExpiryHours(hours);
      setExpiresInHours(hours);
    }
  }, [defaultExpiryHours]);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      applyPayload(await fn());
    } catch (err) {
      setError(err.message || t("handover.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handlePost(event) {
    event.preventDefault();
    const text = body.trim();
    if (!text) {
      setError(t("handover.emptyBody"));
      return;
    }
    await run(async () => {
      const data = await postHandoverNote(token, queueId, {
        body: text,
        counterId: counterId || undefined,
        important,
        pinned,
        expiresInHours,
      });
      setBody("");
      setImportant(false);
      setPinned(false);
      return data;
    });
  }

  const live = activeNotes(notes);
  const rest = sortNotes(notes).filter((row) => noteState(row) !== "active");

  return (
    <section
      data-testid="handover-panel"
      aria-labelledby="handover-heading"
      className="rounded-lg border border-border bg-card px-5 py-4 shadow-card"
    >
      <header className="mb-3">
        <h2 id="handover-heading" className="font-heading text-base font-semibold text-foreground">
          {t("handover.title")}
        </h2>
        <p className="mt-0.5 text-sm text-text-secondary">{t("handover.subtitle")}</p>
      </header>

      <form onSubmit={handlePost} className="mb-4 flex flex-col gap-2" data-testid="handover-compose">
        <Label htmlFor="handover-body" className="text-xs">
          {t("handover.composeLabel")}
        </Label>
        <textarea
          id="handover-body"
          value={body}
          maxLength={NOTE_BODY_MAX}
          onChange={(event) => setBody(clampNoteBody(event.target.value))}
          placeholder={t("handover.placeholder")}
          rows={3}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-muted"
          data-testid="handover-body"
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span>{t("handover.scope")}</span>
            <select
              value={counterId}
              onChange={(event) => setCounterId(event.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              data-testid="handover-scope"
              disabled={busy}
            >
              <option value="">{t("handover.queueWide")}</option>
              {counters.map((counter) => (
                <option key={counter.id} value={counter.id}>
                  {counter.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span>{t("handover.expiryLabel")}</span>
            <select
              value={expiresInHours}
              onChange={(event) => setExpiresInHours(Number(event.target.value))}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              data-testid="handover-expiry"
              disabled={busy}
            >
              {EXPIRY_PRESETS.map((hours) => (
                <option key={hours} value={hours}>
                  {expiryPresetLabel(hours, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
              data-testid="handover-compose-pin"
              disabled={busy}
            />
            {t("handover.pin")}
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={important}
              onChange={(event) => setImportant(event.target.checked)}
              data-testid="handover-compose-important"
              disabled={busy}
            />
            {t("handover.important")}
          </label>
          <span className="ml-auto text-xs text-text-muted" data-testid="handover-chars">
            {t("handover.chars", { n: body.length, max: NOTE_BODY_MAX })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !body.trim()} data-testid="handover-post">
            {busy ? t("handover.posting") : t("handover.post")}
          </Button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-danger-ink" data-testid="handover-error">
          {error}
        </p>
      ) : null}

      {loading && !notes.length ? (
        <p className="text-sm text-text-muted">{t("handover.loading")}</p>
      ) : live.length === 0 && rest.length === 0 ? (
        <p className="text-sm text-text-muted" data-testid="handover-empty">
          {t("handover.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {live.length ? (
            <ul className="flex flex-col gap-2" data-testid="handover-active-list">
              {live.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  locale={locale}
                  t={t}
                  busy={busy}
                  onPin={(row) => run(() => patchHandoverNote(token, queueId, row.id, { pinned: !row.pinned }))}
                  onFlag={(row) => run(() => patchHandoverNote(token, queueId, row.id, { important: !row.important }))}
                  onAck={(row) => run(() => ackHandoverNote(token, queueId, row.id))}
                  onResolve={(row) => run(() => resolveHandoverNote(token, queueId, row.id))}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted" data-testid="handover-empty">
              {t("handover.empty")}
            </p>
          )}
          {rest.length ? (
            <ul className="flex flex-col gap-2" data-testid="handover-past-list">
              {rest.map((note) => (
                <NoteCard key={note.id} note={note} locale={locale} t={t} busy={busy} onPin={() => {}} onFlag={() => {}} onAck={() => {}} onResolve={() => {}} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <p className="mt-3 text-xs text-text-muted">{t("handover.defaultHint", { hours: expiryHours })}</p>
    </section>
  );
}
