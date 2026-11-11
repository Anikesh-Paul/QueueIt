import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { PageToolbar } from "@/components/shell/page-toolbar";
import { RealtimeIndicator } from "@/components/realtime-indicator";
import { cn } from "@/lib/utils";

export function AdminConsoleToolbar({
  queueId,
  queueName,
  paused,
  acceptingTokens,
  waitingLoading,
  realtimeConnected,
  adminActionBusy,
  adminReset,
}) {
  const navigate = useNavigate();
  const [resetOpen, setResetOpen] = useState(false);

  return (
      <PageToolbar
        tier="admin"
        title={<span data-testid="admin-queue-name">{queueName}</span>}
        meta={
          <>
            <span className="shrink-0">
              {realtimeConnected
                ? "Instant updates"
                : "Waiting list updates every few seconds"}
            </span>
            <RealtimeIndicator connected={realtimeConnected} testId="admin-realtime-status" />
            {waitingLoading ? <span className="shrink-0">· loading…</span> : null}
          </>
        }
        status={
          <span className="flex flex-wrap items-center gap-1.5">
            {!acceptingTokens ? (
              <span
                data-testid="admin-queue-accepting"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-text-secondary"
              >
                <span className="size-1.5 rounded-full bg-text-muted" />
                Closed
              </span>
            ) : null}
            <span
              data-testid="admin-queue-status"
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                paused ? "bg-[#FEF3C7] text-[#92400E]" : "bg-primary-muted text-primary"
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", paused ? "bg-[#D97706]" : "bg-primary")}
              />
              {paused ? "Paused" : "Open"}
            </span>
          </span>
        }
        actions={
          <>
            <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={adminActionBusy}
                  data-testid="admin-reset"
                  className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin/catalog")}
              data-testid="open-catalog"
            >
              Catalog
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/admin/queues/${queueId}/analytics`)}
              data-testid="open-analytics"
            >
              Analytics
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/queues")}>
              Back to queues
            </Button>
          </>
        }
      />

  );
}
