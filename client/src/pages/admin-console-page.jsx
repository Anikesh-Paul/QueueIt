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
import { AdminHandoverNotes } from "@/components/admin/admin-handover-notes";

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
        <h1 data-testid="admin-heading" className="mb-4 page-title">
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
            <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-primary uppercase">Admin console</p>
            <h1 data-testid="admin-heading" className="page-title">
              {queueName}
            </h1>
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
          Phone: operate + waiting list, then arrival + walk-in, then setup.
          ≥lg: operate + waiting list over setup on the left; arrival + walk-in
          stay in a sticky column on the right.
        */}
        <div
          data-testid="admin-layout"
          className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(17.5rem,22rem)] lg:items-start lg:gap-x-5 lg:gap-y-4"
        >
          <div data-testid="admin-operate-column" className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
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
            <AdminWaitingList
              waitingList={waitingList}
              waitingLoading={waitingLoading}
              empty={empty}
              selectedEntryId={selectedEntryId}
              setSelectedEntryId={setSelectedEntryId}
            />
            <AdminAppointments
              token={token}
              queueId={queueId}
              refreshKey={waitingList.length}
              onCheckedIn={() => openAdminConsole(queueId)}
            />
          </div>

          <aside
            data-testid="admin-side-column"
            className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[7.5rem] lg:col-start-2 lg:row-span-2 lg:row-start-1"
          >
            <AdminCheckArrival
              token={token}
              queueId={queueId}
              setSelectedEntryId={setSelectedEntryId}
            />
            <AdminWalkIn adminActionBusy={adminActionBusy} adminWalkIn={adminWalkIn} groups={adminQueueMeta?.groups} />
          </aside>

          <div data-testid="admin-setup-column" className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
            <h2 className="mt-4 flex items-center gap-3 text-xs font-semibold tracking-[0.08em] text-text-muted uppercase after:h-px after:flex-1 after:bg-border">
              Line setup
            </h2>
            <AdminServiceWindows
              queueId={queueId}
              adminQueueMeta={adminQueueMeta}
              adminActionBusy={adminActionBusy}
              adminUpdateServiceWindows={adminUpdateServiceWindows}
            />
            <AdminHandoverNotes
              token={token}
              queueId={queueId}
              counters={adminQueueMeta?.counters || []}
              defaultExpiryHours={adminQueueMeta?.handover?.expiryHours}
            />
            <AdminCounters
              counters={adminQueueMeta?.counters}
              adminActionBusy={adminActionBusy}
              adminAddCounter={adminAddCounter}
              adminRemoveCounter={adminRemoveCounter}
              adminRenameCounter={adminRenameCounter}
            />
            <AdminPosterQr queueId={queueId} queueName={queueName} />
          </div>
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
