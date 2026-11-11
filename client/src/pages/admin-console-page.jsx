import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAdminConsole } from "@/context/app-context";
import { ShellContent } from "@/components/shell/shell-content";
import { AdminConsoleToolbar } from "@/components/admin/admin-console-toolbar";
import { AdminOperatePanel } from "@/components/admin/admin-operate-panel";
import { AdminServiceWindows } from "@/components/admin/admin-service-windows";
import { AdminWalkIn } from "@/components/admin/admin-walk-in";
import { AdminWaitingList } from "@/components/admin/admin-waiting-list";
import { AdminCheckArrival } from "@/components/admin/admin-check-arrival";

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

  return (
    <>
      <AdminConsoleToolbar
        queueId={queueId}
        queueName={queueName}
        paused={paused}
        acceptingTokens={acceptingTokens}
        waitingLoading={waitingLoading}
        realtimeConnected={realtimeConnected}
        adminActionBusy={adminActionBusy}
        adminReset={adminReset}
      />

      <ShellContent tier="admin">
        <header className="mb-6 flex items-end justify-between gap-4">
          <h1
            data-testid="admin-heading"
            className="font-heading text-headline leading-tight text-foreground"
          >
            Admin
          </h1>
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
            />
            <AdminServiceWindows
              queueId={queueId}
              adminQueueMeta={adminQueueMeta}
              adminActionBusy={adminActionBusy}
              adminUpdateServiceWindows={adminUpdateServiceWindows}
            />
            <AdminWalkIn adminActionBusy={adminActionBusy} adminWalkIn={adminWalkIn} />
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
      </ShellContent>
    </>
  );
}
