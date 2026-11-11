import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
}) {
  const navigate = useNavigate();

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
