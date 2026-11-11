import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Destructive reset — end of the admin console, not the sticky toolbar.
 * Still behind the existing confirm dialog.
 */
export function AdminResetDangerZone({ queueName, adminActionBusy, adminReset }) {
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <section
      data-testid="admin-danger-zone"
      className="mt-6 overflow-hidden rounded-xl border border-destructive/25 bg-card px-5 py-5 shadow-card"
    >
      <h2 className="text-label uppercase tracking-wide text-destructive">Danger zone</h2>
      <p className="mt-1 max-w-xl text-sm text-text-secondary">
        Reset clears everyone in line and restarts token numbers. This cannot be undone.
        Pause and stop accepting tokens stay in the operate panel above.
      </p>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={adminActionBusy}
            data-testid="admin-reset"
            className="mt-4 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            Reset queue
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent data-testid="admin-reset-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {queueName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Clears the line and restarts tokens.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructiveSolid"
              data-testid="admin-reset-confirm"
              onClick={(event) => {
                event.preventDefault();
                setResetOpen(false);
                adminReset();
              }}
            >
              {adminActionBusy ? "Working…" : "Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
