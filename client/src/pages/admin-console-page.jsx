import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { useAdminConsole } from "@/context/app-context";
import { ShellContent } from "@/components/shell/shell-content";
import { AdminConsoleToolbar } from "@/components/admin/admin-console-toolbar";
import { AdminOperatePanel } from "@/components/admin/admin-operate-panel";
import { AdminServiceWindows } from "@/components/admin/admin-service-windows";
import { AdminWalkIn } from "@/components/admin/admin-walk-in";
import { AdminWaitingList } from "@/components/admin/admin-waiting-list";
import { AdminCheckArrival } from "@/components/admin/admin-check-arrival";
import { AdminPosterQr } from "@/components/admin/admin-poster-qr";
import { AdminCounters } from "@/components/admin/admin-counters";
import { AdminResetDangerZone } from "@/components/admin/admin-reset-danger-zone";
import { AdminAuditPanel } from "@/components/admin/admin-audit-panel";
import { AdminAppointments } from "@/components/admin/admin-appointments";

/**
 * Admin console — medium-density waiting list + operate | Check arrival (lg+).
 * Phone: list first, arrival below (optional in-page jump — not sticky bottom bar).
 * No motif wallpaper; no production Admin API diagnostics.
 */
export function AdminConsolePage() {
  const { queueId } = useParams();
  const {
    token,
    openAdminConsole,
    clearAdminConsole,
    adminQueueMeta,
    waitingList,
    waitingLoading,
    waitingError,
    waitingDenied,
    adminActionBusy,
    adminActionError,
    selectedEntryId,
    setSelectedEntryId,
    adminCall,
    adminServe,
    adminSkip,
    adminPause,
    adminResume,
    adminStopAccepting,
    adminStartAccepting,
    adminExtend,
    adminUpdateServiceWindows,
    adminReset,
    adminWalkIn,
    adminAddCounter,
    adminRenameCounter,
    adminRemoveCounter,
    adminMarkPriority,
    adminDecidePriorityRequest,
    realtimeConnected,
  } = useAdminConsole();

  useEffect(() => {
    if (queueId) openAdminConsole(queueId);
  }, [queueId, openAdminConsole]);

  useEffect(() => {
    return () => {
      clearAdminConsole();
    };
  }, [clearAdminConsole]);

  const paused = adminQueueMeta?.status === "paused";
  const acceptingTokens = adminQueueMeta?.acceptingTokens !== false;
  const queueName = adminQueueMeta?.name || "Queue";
  const empty = waitingList.length === 0;

  // Another venue's or organization's queue: one clear message instead of a
  // console full of refused panels. The server refuses every action anyway.
  if (waitingDenied && !adminQueueMeta) {
    return (
      <ShellContent tier="admin" className="max-w-2xl">
        <h1 data-testid="admin-heading" className="mb-4 font-heading text-headline leading-tight text-foreground">
          Admin console
        </h1>
        <ErrorState
          testId="admin-no-access"
          title="You can't manage this queue"
          message={waitingError}
          detail="It belongs to a venue or organization you haven't been given. Ask a global admin if you need it."
        />
        <Button asChild variant="secondary" size="sm" className="mt-4">
          <Link to="/admin/catalog">Back to your catalog</Link>
        </Button>
      </ShellContent>
    );
  }

  return (
    <>
      <AdminConsoleToolbar
        queueId={queueId}
        queueName={queueName}
        paused={paused}
        acceptingTokens={acceptingTokens}
        waitingLoading={waitingLoading}
        realtimeConnected={realtimeConnected}
      />

      <ShellContent tier="admin">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1
              data-testid="admin-heading"
              className="font-heading text-headline leading-tight text-foreground"
            >
              {queueName}
            </h1>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-text-muted">
              Admin console
            </p>
          </div>
          {/* Phone-only in-page jump — not a sticky bottom bar */}
          <a
            href="#check-arrival"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline lg:hidden"
            data-testid="jump-check-arrival"
          >
            Check arrival
          </a>
        </header>

        {/*
          ≥lg: waiting list + operate | Check arrival
          phone: list first, arrival below
        */}
        <div
          data-testid="admin-layout"
          className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(17.5rem,22rem)] lg:items-start lg:gap-5"
        >
          <div data-testid="admin-operate-column" className="flex min-w-0 flex-col gap-4">
            <AdminOperatePanel
              adminQueueMeta={adminQueueMeta}
              waitingList={waitingList}
              waitingError={waitingError}
              adminActionBusy={adminActionBusy}
              adminActionError={adminActionError}
              selectedEntryId={selectedEntryId}
              paused={paused}
              acceptingTokens={acceptingTokens}
              empty={empty}
              adminCall={adminCall}
              adminServe={adminServe}
              adminSkip={adminSkip}
              adminPause={adminPause}
              adminResume={adminResume}
              adminStopAccepting={adminStopAccepting}
              adminStartAccepting={adminStartAccepting}
              adminExtend={adminExtend}
              adminMarkPriority={adminMarkPriority}
              adminDecidePriorityRequest={adminDecidePriorityRequest}
            />
            <AdminAppointments
              token={token}
              queueId={queueId}
              refreshKey={waitingList.length}
              onCheckedIn={() => openAdminConsole(queueId)}
            />
            <AdminServiceWindows
              queueId={queueId}
              adminQueueMeta={adminQueueMeta}
              adminActionBusy={adminActionBusy}
              adminUpdateServiceWindows={adminUpdateServiceWindows}
            />
            <AdminWalkIn adminActionBusy={adminActionBusy} adminWalkIn={adminWalkIn} />
            <AdminCounters
              counters={adminQueueMeta?.counters}
              adminActionBusy={adminActionBusy}
              adminAddCounter={adminAddCounter}
              adminRenameCounter={adminRenameCounter}
              adminRemoveCounter={adminRemoveCounter}
            />
            <AdminPosterQr queueId={queueId} queueName={queueName} />
            <AdminWaitingList
              waitingList={waitingList}
              waitingLoading={waitingLoading}
              empty={empty}
              selectedEntryId={selectedEntryId}
              setSelectedEntryId={setSelectedEntryId}
            />
          </div>

          <AdminCheckArrival
            token={token}
            queueId={queueId}
            setSelectedEntryId={setSelectedEntryId}
          />
        </div>
        <AdminAuditPanel token={token} queueId={queueId} />
        <AdminResetDangerZone
          queueName={queueName}
          adminActionBusy={adminActionBusy}
          adminReset={adminReset}
        />
      </ShellContent>
    </>
  );
}
