import { formatCampusClockTime } from "@/lib/campus-time";
import { Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const PRIORITY_REASON_LABELS = {
  accessibility: "Accessibility",
  pregnancy: "Pregnancy",
  medical: "Medical / urgent",
  other: "Other",
};

export function priorityReasonLabel(reason) {
  return PRIORITY_REASON_LABELS[reason] || reason;
}


export function AdminWaitingList({
  waitingList,
  waitingLoading,
  empty,
  selectedEntryId,
  setSelectedEntryId,
}) {
  return (
            <section className="overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card">
              <h2 className="text-label uppercase tracking-wide text-text-muted">
                Waiting list
              </h2>

              {waitingLoading && (
                <div className="mt-3 flex flex-col gap-2" aria-busy="true">
                  <Skeleton className="h-12 rounded-lg" />
                  <Skeleton className="h-12 rounded-lg" />
                </div>
              )}

              {!waitingLoading && empty && (
                <EmptyState
                  className="mt-3"
                  icon={Users}
                  testId="admin-waiting-empty"
                  title="No one waiting"
                  hint="New joins from the app, the poster QR and walk-ins appear here automatically."
                />
              )}

              {!waitingLoading && !empty && (
                <ul className="mt-3 flex flex-col gap-2" data-testid="admin-waiting-list">
                  {waitingList.map((entry) => {
                    const isSelected = entry.id === selectedEntryId;
                    const isWalkIn = Boolean(entry.isWalkIn);
                    const isGuest = Boolean(entry.isGuest) && !isWalkIn;
                    const isCalled = entry.status === "serving";
                    // Token-first rows: Guest badge only (no name/email); walk-in keeps name.
                    const displayName = isGuest
                      ? null
                      : entry.user?.name || (isWalkIn ? "Walk-in" : "User");
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md border border-border bg-secondary px-3.5 py-2.5 text-left shadow-card outline-none transition-[border,background-color] hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/50",
                            isSelected && "border-primary bg-primary-muted/60",
                            isCalled && "border-primary/40 bg-primary-muted/40"
                          )}
                          onClick={() =>
                            setSelectedEntryId((prev) => (prev === entry.id ? null : entry.id))
                          }
                          aria-pressed={isSelected}
                          data-testid="waiting-entry"
                          data-token={entry.tokenNumber}
                          data-walk-in={isWalkIn ? "true" : "false"}
                          data-guest={isGuest ? "true" : "false"}
                          data-status={entry.status || "waiting"}
                        >
                          <span className="w-10 shrink-0 font-metric text-base font-bold tabular-nums text-foreground">
                            #{entry.tokenNumber}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                              {displayName ? <span className="truncate">{displayName}</span> : null}
                              {isGuest ? (
                                <span
                                  className="badge--guest shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-text-secondary ring-1 ring-border"
                                  data-testid="waiting-guest-badge"
                                >
                                  Guest
                                </span>
                              ) : null}
                              {isWalkIn ? (
                                <span className="ml-0.5 text-xs font-semibold text-text-muted">
                                  · Walk-in
                                </span>
                              ) : null}
                              {isCalled ? (
                                <span
                                  className="shrink-0 rounded-full bg-primary-muted px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/30"
                                  data-testid="waiting-called-badge"
                                >
                                  {entry.servingCounterName
                                    ? `Called · ${entry.servingCounterName}`
                                    : "Called"}
                                </span>
                              ) : null}
                              {isCalled && entry.here ? (
                                <span
                                  className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
                                  data-testid="waiting-here-badge"
                                >
                                  Here
                                </span>
                              ) : null}
                              {entry.appointmentAt ? (
                                <span
                                  className="shrink-0 rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info-ink"
                                  data-testid="waiting-booked-badge"
                                >
                                  Booked · {formatCampusClockTime(entry.appointmentAt)}
                                </span>
                              ) : null}
                              {entry.returning ? (
                                <span
                                  className="shrink-0 rounded-full bg-primary-muted px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/30"
                                  data-testid="waiting-returning-badge"
                                >
                                  Returning
                                </span>
                              ) : null}
                              {entry.priority ? (
                                <span
                                  className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
                                  data-testid="waiting-priority-badge"
                                >
                                  Priority
                                  {entry.priorityReason ? ` · ${priorityReasonLabel(entry.priorityReason)}` : ""}
                                </span>
                              ) : entry.priorityRequestStatus === "pending" ? (
                                <span
                                  className="shrink-0 rounded-full bg-primary-muted px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/30"
                                  data-testid="waiting-priority-requested-badge"
                                >
                                  Priority requested
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-text-muted">
                              {isCalled
                                ? entry.here
                                  ? "Checked in · no-show timer stopped"
                                  : entry.servingTimerFrozen
                                  ? "Timer paused"
                                  : entry.servingRemainingSeconds != null
                                    ? `${Math.max(0, entry.servingRemainingSeconds)}s to arrive${
                                        entry.noShowWindowMinutes
                                          ? ` · ${entry.noShowWindowMinutes} min window${
                                              entry.noShowWindowMode === "dynamic" ? " (dynamic)" : ""
                                            }`
                                          : ""
                                      }`
                                    : "Called to the counter"
                                : `Position ${entry.position}`}
                              {!isGuest && entry.user?.email ? ` · ${entry.user.email}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

  );
}
