import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertOctagon, Clock3, Info, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { useApp } from "@/context/app-context";
import { editNotice, endNotice, fetchAdminCatalog, fetchConsoleNotices, postNotice } from "@/api";
import { BODY_MAX, TITLE_MAX, audienceLabel, toCampusInput, untilLabel } from "@/lib/announcements";
import { campusDatetimeLocalToIso, formatCampusDateTime } from "@/lib/campus-time";
import { staffCanManageQueue } from "@/lib/staff-access";
import { cn } from "@/lib/utils";

const TONES = [
  { id: "info", label: "Info", icon: Info, hint: "General news" },
  { id: "delay", label: "Delay", icon: Clock3, hint: "Slower than usual" },
  { id: "closure", label: "Closure", icon: AlertOctagon, hint: "Closed or closing" },
];

const TONE_PILL = {
  info: "bg-info-soft text-info-ink",
  delay: "bg-warning-soft text-warning-ink",
  closure: "bg-danger-soft text-danger-ink",
};

const STATE_PILL = {
  live: "bg-success/12 text-success",
  scheduled: "bg-secondary text-text-secondary",
  ended: "bg-secondary text-text-muted",
};

const FIELD =
  "w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

function emptyDraft(defaultAudience) {
  return { audience: defaultAudience, tone: "info", title: "", body: "", startsAt: "", endsAt: "" };
}

function parseAudience(value) {
  const [scope, id] = String(value || "").split(":");
  if (scope === "campus") return { scope };
  if (scope === "venue") return { scope, venueId: id };
  if (scope === "queue") return { scope, queueId: id };
  return {};
}

function Pill({ className, children, testId }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", className)} data-testid={testId}>
      {children}
    </span>
  );
}

function ToneField({ value, onChange, disabled, idPrefix }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-foreground">Tone</legend>
      <div className="grid grid-cols-3 gap-2">
        {TONES.map((tone) => {
          const Icon = tone.icon;
          const checked = value === tone.id;
          return (
            <label
              key={tone.id}
              htmlFor={`${idPrefix}-tone-${tone.id}`}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                checked ? "border-primary bg-primary-muted/50 ring-1 ring-primary" : "border-border bg-background hover:bg-secondary/60"
              )}
            >
              <input
                id={`${idPrefix}-tone-${tone.id}`}
                type="radio"
                name={`${idPrefix}-tone`}
                value={tone.id}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(tone.id)}
                className="sr-only"
                data-testid={`notice-tone-${tone.id}`}
              />
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Icon className="size-4 text-text-secondary" aria-hidden="true" />
                {tone.label}
              </span>
              <span className="text-xs text-text-muted">{tone.hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function NoticeFields({ draft, setDraft, disabled, idPrefix, audienceOptions }) {
  const set = (key) => (event) => setDraft((d) => ({ ...d, [key]: event.target.value }));
  return (
    <div className="flex flex-col gap-4">
      {audienceOptions ? (
        <div>
          <Label htmlFor={`${idPrefix}-audience`}>Who sees it</Label>
          <select
            id={`${idPrefix}-audience`}
            value={draft.audience}
            onChange={set("audience")}
            disabled={disabled}
            className={cn(FIELD, "mt-1.5 h-9")}
            data-testid="notice-audience"
          >
            {audienceOptions}
          </select>
        </div>
      ) : null}
      <ToneField value={draft.tone} onChange={(tone) => setDraft((d) => ({ ...d, tone }))} disabled={disabled} idPrefix={idPrefix} />
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor={`${idPrefix}-title`}>Title</Label>
          <span className="text-xs text-text-muted" aria-hidden="true">
            {draft.title.length}/{TITLE_MAX}
          </span>
        </div>
        <Input
          id={`${idPrefix}-title`}
          value={draft.title}
          maxLength={TITLE_MAX}
          onChange={set("title")}
          disabled={disabled}
          placeholder="Counter 2 closed until 3 PM"
          className="mt-1.5"
          data-testid="notice-title"
        />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor={`${idPrefix}-body`}>
            Details <span className="font-normal text-text-muted">(optional)</span>
          </Label>
          <span className="text-xs text-text-muted" aria-hidden="true">
            {draft.body.length}/{BODY_MAX}
          </span>
        </div>
        <textarea
          id={`${idPrefix}-body`}
          value={draft.body}
          maxLength={BODY_MAX}
          rows={3}
          onChange={set("body")}
          disabled={disabled}
          placeholder="What should people do differently?"
          className={cn(FIELD, "mt-1.5 resize-y py-2 leading-5")}
          data-testid="notice-body"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-starts`}>
            Starts <span className="font-normal text-text-muted">(IST, blank = now)</span>
          </Label>
          <input
            id={`${idPrefix}-starts`}
            type="datetime-local"
            value={draft.startsAt}
            onChange={set("startsAt")}
            disabled={disabled}
            className={cn(FIELD, "mt-1.5 h-9")}
            data-testid="notice-starts"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-ends`}>
            Ends <span className="font-normal text-text-muted">(IST, blank = end of day)</span>
          </Label>
          <input
            id={`${idPrefix}-ends`}
            type="datetime-local"
            value={draft.endsAt}
            onChange={set("endsAt")}
            disabled={disabled}
            className={cn(FIELD, "mt-1.5 h-9")}
            data-testid="notice-ends"
          />
        </div>
      </div>
    </div>
  );
}

function payloadFrom(draft, { includeAudience }) {
  const body = {
    tone: draft.tone,
    title: draft.title,
    body: draft.body,
  };
  if (draft.startsAt) body.startsAt = campusDatetimeLocalToIso(draft.startsAt);
  if (draft.endsAt) body.endsAt = campusDatetimeLocalToIso(draft.endsAt);
  return includeAudience ? { ...body, ...parseAudience(draft.audience) } : body;
}

function NoticeRow({ notice, busy, onSave, onEnd }) {
  const [editing, setEditing] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");

  function startEdit() {
    setDraft({
      tone: notice.tone,
      title: notice.title,
      body: notice.body || "",
      startsAt: toCampusInput(notice.startsAt),
      endsAt: toCampusInput(notice.endsAt),
    });
    setError("");
    setEditing(true);
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    const err = await onSave(notice.id, payloadFrom(draft, { includeAudience: false }));
    if (err) setError(err);
    else setEditing(false);
  }

  const when =
    notice.state === "scheduled"
      ? `Starts ${formatCampusDateTime(notice.startsAt)}`
      : notice.state === "live"
        ? `Until ${untilLabel(notice.endsAt)}`
        : `Ended ${formatCampusDateTime(notice.endsAt)}`;

  return (
    <li className="px-5 py-4" data-testid="console-notice" data-state={notice.state}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className={STATE_PILL[notice.state]} testId="console-notice-state">
              {notice.state === "live" ? "Live" : notice.state === "scheduled" ? "Scheduled" : "Ended"}
            </Pill>
            <Pill className={TONE_PILL[notice.tone]}>{TONES.find((t) => t.id === notice.tone)?.label}</Pill>
            <span className="text-xs text-text-muted">{audienceLabel(notice)}</span>
          </div>
          <p className={cn("mt-1.5 text-sm font-semibold", notice.state === "ended" ? "text-text-secondary" : "text-foreground")}>
            {notice.title}
          </p>
          {notice.body ? <p className="mt-0.5 text-sm text-text-secondary">{notice.body}</p> : null}
          <p className="mt-1 text-xs text-text-muted">
            {when}
            {notice.author ? ` · posted by ${notice.author}` : ""}
          </p>
        </div>
        {notice.canManage && notice.state !== "ended" && !editing ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {confirmEnd ? (
              <>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => onEnd(notice.id)} data-testid="console-notice-end-confirm">
                  End it now
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmEnd(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={startEdit} data-testid="console-notice-edit">
                  <Pencil className="size-3.5" aria-hidden="true" />
                  Edit
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmEnd(true)} data-testid="console-notice-end">
                  End now
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
      {editing && draft ? (
        <form onSubmit={save} className="mt-4 rounded-lg border border-border bg-background/60 p-4" data-testid="console-notice-form">
          <NoticeFields draft={draft} setDraft={setDraft} disabled={busy} idPrefix={`edit-${notice.id}`} />
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger-ink">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !draft.title.trim()} data-testid="console-notice-save">
              Save changes
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/**
 * Announcement board for staff: post a notice to the campus, a venue or one
 * line, and see what is live, scheduled, or recently ended.
 */
export function AdminNoticesPage() {
  const { token, user } = useApp();
  const isAdmin = user?.role === "admin";
  const [notices, setNotices] = useState(null);
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft(""));
  const [formError, setFormError] = useState("");
  const [posted, setPosted] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [list, catalog] = await Promise.all([fetchConsoleNotices(token), fetchAdminCatalog(token)]);
      setNotices(list.announcements || []);
      setVenues(Array.isArray(catalog.venues) ? catalog.venues : []);
    } catch (err) {
      setError(err.message || "Couldn't load notices");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const audiences = useMemo(() => {
    const out = [];
    if (isAdmin) out.push({ value: "campus", label: "Everyone on campus" });
    for (const venue of venues) {
      const venueOk = isAdmin || (user?.staffVenueId === venue.id && !(user?.staffQueueIds || []).length);
      const queues = (venue.queues || []).filter((q) => !q.archived && staffCanManageQueue(user, { ...q, venue: { id: venue.id } }));
      if (!venueOk && !queues.length) continue;
      out.push({
        group: venue.name,
        items: [
          ...(venueOk ? [{ value: `venue:${venue.id}`, label: `Everyone at ${venue.name}` }] : []),
          ...queues.map((q) => ({ value: `queue:${q.id}`, label: `${q.name} line` })),
        ],
      });
    }
    return out;
  }, [venues, isAdmin, user]);

  const firstAudience = audiences[0]?.value || audiences[0]?.items?.[0]?.value || "";
  const audienceValue = draft.audience || firstAudience;

  const audienceOptions = audiences.map((a) =>
    a.group ? (
      <optgroup key={a.group} label={a.group}>
        {a.items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </optgroup>
    ) : (
      <option key={a.value} value={a.value}>
        {a.label}
      </option>
    )
  );

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setPosted("");
    try {
      await postNotice(token, payloadFrom({ ...draft, audience: audienceValue }, { includeAudience: true }));
      setDraft(emptyDraft(audienceValue));
      setPosted("Posted. People waiting will see it within a minute.");
      const list = await fetchConsoleNotices(token);
      setNotices(list.announcements || []);
    } catch (err) {
      setFormError(err.message || "Couldn't post that notice");
    } finally {
      setBusy(false);
    }
  }

  async function save(id, body) {
    setBusy(true);
    try {
      await editNotice(token, id, body);
      const list = await fetchConsoleNotices(token);
      setNotices(list.announcements || []);
      return null;
    } catch (err) {
      return err.message || "Couldn't save";
    } finally {
      setBusy(false);
    }
  }

  async function end(id) {
    setBusy(true);
    try {
      await endNotice(token, id);
      const list = await fetchConsoleNotices(token);
      setNotices(list.announcements || []);
    } catch (err) {
      setError(err.message || "Couldn't end that notice");
    } finally {
      setBusy(false);
    }
  }

  const current = (notices || []).filter((n) => n.state !== "ended");
  const ended = (notices || []).filter((n) => n.state === "ended");

  return (
    <>
      <PageToolbar
        tier="admin"
        title="Notices"
        meta="Campus time (IST)"
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} data-testid="notices-refresh">
            Refresh
          </Button>
        }
      />
      <ShellContent tier="admin">
        <header className="mb-5">
          <h1 className="font-heading text-headline leading-tight text-foreground" data-testid="notices-heading">
            Announcement board
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Tell people waiting about delays, closures, or what to bring. Notices show on the queue list, the status page and the kiosk screen.
          </p>
        </header>

        {loading && !notices ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" aria-busy="true" aria-label="Loading notices">
            <Skeleton className="h-96 rounded-lg" />
            <Skeleton className="h-60 rounded-lg" />
          </div>
        ) : null}

        {error && !notices ? (
          <ErrorState testId="notices-error" title="Couldn't load notices" message={error} retryLabel="Try again" onRetry={load} />
        ) : null}

        {notices ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <section aria-labelledby="notice-new-title" className="rounded-lg border border-border bg-card px-5 py-4 shadow-card">
              <h2 id="notice-new-title" className="mb-4 font-heading text-base font-semibold text-foreground">
                New notice
              </h2>
              {audiences.length ? (
                <form onSubmit={submit} data-testid="notice-form">
                  <NoticeFields
                    draft={{ ...draft, audience: audienceValue }}
                    setDraft={setDraft}
                    disabled={busy}
                    idPrefix="new"
                    audienceOptions={audienceOptions}
                  />
                  {formError ? (
                    <p role="alert" className="mt-3 text-sm text-danger-ink" data-testid="notice-form-error">
                      {formError}
                    </p>
                  ) : null}
                  {posted ? (
                    <p role="status" className="mt-3 text-sm text-success" data-testid="notice-posted">
                      {posted}
                    </p>
                  ) : null}
                  <Button type="submit" className="mt-4 w-full sm:w-auto" disabled={busy || !draft.title.trim()} data-testid="notice-post">
                    {busy ? "Posting…" : "Post notice"}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-text-muted">You don&apos;t manage any queues yet, so there&apos;s nowhere to post.</p>
              )}
            </section>

            <div className="flex flex-col gap-4">
              <section aria-labelledby="notice-current-title" className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
                <header className="flex items-baseline justify-between border-b border-border px-5 py-3">
                  <h2 id="notice-current-title" className="text-sm font-semibold text-foreground">
                    Live and scheduled
                  </h2>
                  <span className="text-xs text-text-muted">{current.length}</span>
                </header>
                {current.length ? (
                  <ul className="divide-y divide-border" data-testid="notices-current">
                    {current.map((n) => (
                      <NoticeRow key={`${n.id}:${n.updatedAt}`} notice={n} busy={busy} onSave={save} onEnd={end} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-8 text-center text-sm text-text-muted" data-testid="notices-empty">
                    Nothing posted right now.
                  </p>
                )}
              </section>

              {ended.length ? (
                <section aria-labelledby="notice-ended-title" className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
                  <header className="flex items-baseline justify-between border-b border-border px-5 py-3">
                    <h2 id="notice-ended-title" className="text-sm font-semibold text-foreground">
                      Ended in the last 7 days
                    </h2>
                    <span className="text-xs text-text-muted">{ended.length}</span>
                  </header>
                  <ul className="divide-y divide-border">
                    {ended.map((n) => (
                      <NoticeRow key={n.id} notice={n} busy={busy} onSave={save} onEnd={end} />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
        ) : null}
      </ShellContent>
    </>
  );
}
