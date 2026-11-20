import { useEffect, useState } from "react";
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
import { NOTE_BODY_MAX, clampNoteBody } from "@/lib/handover.js";

/**
 * Optional handover note before ending a shift. Staff can skip it.
 */
export function ShiftEndNoteDialog({ open, busy, error, onCancel, onSkip, onSave }) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);

  useEffect(() => {
    if (open) {
      setBody("");
      setImportant(false);
    }
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel?.(); }}>
      <AlertDialogContent className="max-w-lg sm:max-w-lg" data-testid="shift-end-note-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("handover.endTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("handover.endBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <textarea
            value={body}
            maxLength={NOTE_BODY_MAX}
            onChange={(event) => setBody(clampNoteBody(event.target.value))}
            placeholder={t("handover.placeholder")}
            rows={4}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
            data-testid="shift-end-note-body"
            disabled={busy}
          />
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={important}
              onChange={(event) => setImportant(event.target.checked)}
              data-testid="shift-end-note-important"
              disabled={busy}
            />
            {t("handover.important")}
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger-ink" data-testid="shift-end-note-error">
              {error}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel} data-testid="shift-end-note-cancel">
            {t("handover.endCancel")}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onSkip} data-testid="shift-end-note-skip">
            {t("handover.endSkip")}
          </Button>
          <Button
            type="button"
            disabled={busy || !body.trim()}
            onClick={() => onSave({ note: body.trim(), important })}
            data-testid="shift-end-note-save"
          >
            {t("handover.endSave")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
