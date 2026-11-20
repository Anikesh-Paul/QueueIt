import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/i18n-context";
import { formatCampusDateTime } from "@/lib/campus-time";

/**
 * Notes left by the previous shift, shown when someone starts at a counter.
 */
export function ShiftUnreadNotes({ open, notes = [], busyId, error, onAck, onClose }) {
  const { t, locale } = useI18n();
  const pending = notes.filter((note) => !note.acknowledged);

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <AlertDialogContent className="max-w-lg sm:max-w-lg" data-testid="shift-unread-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("handover.startTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending.length ? t("handover.startBody") : t("handover.startEmpty")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pending.length ? (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto" data-testid="shift-unread-list">
            {pending.map((note) => (
              <li key={note.id} className="rounded-md border border-border bg-background px-3 py-2" data-testid="shift-unread-note">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                  {note.important ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning-ink">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      {t("handover.important")}
                    </span>
                  ) : null}
                  <span>{note.counterName || t("handover.queueWide")}</span>
                  {note.author?.name ? <span>· {t("handover.by", { name: note.author.name })}</span> : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
                {note.expiresAt ? (
                  <p className="mt-1 text-xs text-text-muted">{t("handover.expires", { when: formatCampusDateTime(note.expiresAt, locale) })}</p>
                ) : null}
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={Boolean(busyId)}
                  onClick={() => onAck(note)}
                  data-testid="shift-unread-ack"
                >
                  {busyId === note.id ? t("handover.acking") : t("handover.ack")}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger-ink" data-testid="shift-unread-error">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button type="button" variant={pending.length ? "outline" : "default"} onClick={onClose} data-testid="shift-unread-close">
            {pending.length ? t("handover.startLater") : t("handover.startDone")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
