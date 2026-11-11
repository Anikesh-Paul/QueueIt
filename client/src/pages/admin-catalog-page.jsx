import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ShellContent } from "@/components/shell/shell-content";
import { useApp } from "@/context/app-context";
import {
  createAdminQueue,
  createVenue,
  fetchAdminCatalog,
  fetchStaffAccounts,
  inviteStaff,
  updateAdminQueue,
  updateStaffQueues,
  updateVenue,
} from "@/api";

/**
 * Admin catalog — create and edit venues and queues without re-seeding.
 * Seeded Campus Hub / Cafeteria / Gym stay the demo starter.
 */
export function AdminCatalogPage() {
  const { token, user, openAdminConsole } = useApp();
  const navigate = useNavigate();
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [queueVenueId, setQueueVenueId] = useState("");
  const [queueName, setQueueName] = useState("");
  const [queuePace, setQueuePace] = useState("3");
  const [queueCap, setQueueCap] = useState("");
  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffVenueId, setStaffVenueId] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffQueueIds, setStaffQueueIds] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [staffEdits, setStaffEdits] = useState({});
  const [staffInvite, setStaffInvite] = useState(null);
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminCatalog(token);
      const list = Array.isArray(data.venues) ? data.venues : [];
      setVenues(list);
      setQueueVenueId((prev) => prev || list[0]?.id || "");
      setStaffVenueId((prev) => prev || list[0]?.id || "");
      if (user?.role === "admin") {
        const staffData = await fetchStaffAccounts(token);
        setStaffAccounts(Array.isArray(staffData.staff) ? staffData.staff : []);
      } else {
        setStaffAccounts([]);
      }
    } catch (err) {
      setError(err.message || "Could not load catalog");
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err.message || "Could not save catalog");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateVenue(event) {
    event.preventDefault();
    const name = venueName.trim();
    if (!name) return;
    const ok = await run(() => createVenue(token, { name }));
    if (ok) setVenueName("");
  }

  async function handleCreateQueue(event) {
    event.preventDefault();
    const name = queueName.trim();
    const pace = Number(queuePace);
    if (!name || !queueVenueId) return;
    const capRaw = queueCap.trim();
    const ok = await run(() =>
      createAdminQueue(token, {
        venueId: queueVenueId,
        name,
        averageServiceTime: pace,
        maxWaiting: capRaw === "" ? null : Number(capRaw),
      })
    );
    if (ok) {
      setQueueName("");
      setQueuePace("3");
      setQueueCap("");
    }
  }

  async function handleInviteStaff(event) {
    event.preventDefault();
    if (user?.role !== "admin") return;
    const name = staffName.trim();
    const email = staffEmail.trim();
    if (!name || !email || !staffVenueId) return;
    setStaffInvite(null);
    const ok = await run(async () => {
      const result = await inviteStaff(token, {
        name,
        email,
        venueId: staffVenueId,
        temporaryPassword: staffPassword.trim() || undefined,
        queueIds: staffQueueIds,
      });
      setStaffInvite(result);
    });
    if (ok) {
      setStaffName("");
      setStaffEmail("");
      setStaffPassword("");
      setStaffQueueIds([]);
    }
  }

  function toggleInviteQueue(queueId, checked) {
    setStaffQueueIds((prev) => {
      if (checked) return [...new Set([...prev, queueId])];
      return prev.filter((id) => id !== queueId);
    });
  }

  async function handleSaveStaffQueues(member) {
    const queueIds = staffEdits[member.id] ?? member.staffQueueIds ?? [];
    await run(() => updateStaffQueues(token, member.id, { queueIds }));
    setStaffEdits((prev) => {
      const next = { ...prev };
      delete next[member.id];
      return next;
    });
  }

  function toggleStaffEditQueue(member, queueId, checked) {
    setStaffEdits((prev) => {
      const current = prev[member.id] ?? member.staffQueueIds ?? [];
      const next = checked
        ? [...new Set([...current, queueId])]
        : current.filter((id) => id !== queueId);
      return { ...prev, [member.id]: next };
    });
  }

  async function handleSaveQueue(queue) {
    const draft = drafts[queue.id] || {};
    const name = (draft.name ?? queue.name).trim();
    const pace = Number(draft.averageServiceTime ?? queue.averageServiceTime);
    const capRaw = draft.maxWaiting !== undefined ? draft.maxWaiting : (queue.maxWaiting ?? "");
    const noShowRaw = draft.noShowMinutes !== undefined ? draft.noShowMinutes : (queue.noShowMinutes ?? "");
    const noShowMode = draft.noShowMode !== undefined ? draft.noShowMode : (queue.noShowMode ?? "fixed");
    const noShowMinRaw =
      draft.noShowMinMinutes !== undefined ? draft.noShowMinMinutes : (queue.noShowMinMinutes ?? "");
    const noShowMaxRaw =
      draft.noShowMaxMinutes !== undefined ? draft.noShowMaxMinutes : (queue.noShowMaxMinutes ?? "");
    const recoveryMinsRaw =
      draft.recoveryMinutes !== undefined ? draft.recoveryMinutes : (queue.recoveryMinutes ?? "");
    const recoveryPlacesRaw =
      draft.recoveryPlaces !== undefined ? draft.recoveryPlaces : (queue.recoveryPlaces ?? "");
    const priorityKRaw =
      draft.priorityEveryK !== undefined ? draft.priorityEveryK : (queue.priorityEveryK ?? "");
    const equivalentGroupRaw =
      draft.equivalentGroup !== undefined ? draft.equivalentGroup : (queue.equivalentGroup ?? "");
    await run(() =>
      updateAdminQueue(token, queue.id, {
        name,
        averageServiceTime: pace,
        maxWaiting: capRaw === "" || capRaw == null ? null : Number(capRaw),
        noShowMinutes: noShowRaw === "" || noShowRaw == null ? "" : Number(noShowRaw),
        noShowMode,
        noShowMinMinutes: noShowMinRaw === "" || noShowMinRaw == null ? "" : Number(noShowMinRaw),
        noShowMaxMinutes: noShowMaxRaw === "" || noShowMaxRaw == null ? "" : Number(noShowMaxRaw),
        recoveryMinutes: recoveryMinsRaw === "" || recoveryMinsRaw == null ? "" : Number(recoveryMinsRaw),
        recoveryPlaces:
          recoveryPlacesRaw === "" || recoveryPlacesRaw == null ? "" : Number(recoveryPlacesRaw),
        priorityEveryK: priorityKRaw === "" || priorityKRaw == null ? "" : Number(priorityKRaw),
        equivalentGroup: equivalentGroupRaw == null ? "" : String(equivalentGroupRaw),
      })
    );
  }

  async function handleArchive(queue, archived) {
    await run(() => updateAdminQueue(token, queue.id, { archived }));
  }

  async function handleRenameVenue(venue) {
    const draft = drafts[`venue:${venue.id}`];
    const name = (draft ?? venue.name).trim();
    if (!name || name === venue.name) return;
    await run(() => updateVenue(token, venue.id, { name }));
  }

  async function handleOpen(queue) {
    await openAdminConsole(queue.id);
    navigate(`/admin/queues/${queue.id}`);
  }

  return (
    <ShellContent tier="admin">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            data-testid="catalog-heading"
            className="font-heading text-headline leading-tight text-foreground"
          >
            Catalog
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Add or edit venues and queues. Seeded Cafeteria and Gym stay as the demo starter.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/admin/analytics")}
          data-testid="catalog-campus-analytics"
        >
          Campus analytics
        </Button>
      </header>

      {error ? <Alert variant="destructive" className="mb-4">{error}</Alert> : null}

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading catalog">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {venues.map((venue) => (
            <section
              key={venue.id}
              data-testid="catalog-venue"
              className="rounded-xl border border-border bg-card p-5 shadow-card"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`venue-name-${venue.id}`}>Venue</Label>
                  <Input
                    id={`venue-name-${venue.id}`}
                    defaultValue={venue.name}
                    onChange={(event) =>
                      setDrafts((prev) => ({ ...prev, [`venue:${venue.id}`]: event.target.value }))
                    }
                    data-testid="catalog-venue-name"
                    disabled={busy}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleRenameVenue(venue)}
                  disabled={busy}
                  data-testid="catalog-venue-save"
                >
                  Save name
                </Button>
              </div>

              <ul className="mt-4 flex flex-col gap-3">
                {(venue.queues || []).map((queue) => (
                  <li
                    key={queue.id}
                    data-testid="catalog-queue"
                    data-archived={queue.archived ? "true" : "false"}
                    className="rounded-md border border-border bg-secondary px-3.5 py-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                      <div className="min-w-0 flex-1 sm:min-w-56">
                        <Label htmlFor={`queue-name-${queue.id}`}>Queue</Label>
                        <Input
                          id={`queue-name-${queue.id}`}
                          defaultValue={queue.name}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: { ...(prev[queue.id] || {}), name: event.target.value },
                            }))
                          }
                          data-testid="catalog-queue-name"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-28">
                        <Label htmlFor={`queue-pace-${queue.id}`}>Avg. service (min)</Label>
                        <Input
                          id={`queue-pace-${queue.id}`}
                          type="number"
                          min="1"
                          max="60"
                          defaultValue={queue.averageServiceTime}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                averageServiceTime: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-pace"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-36">
                        <Label htmlFor={`queue-noshow-mode-${queue.id}`}>No-show mode</Label>
                        <select
                          id={`queue-noshow-mode-${queue.id}`}
                          defaultValue={queue.noShowMode === "dynamic" ? "dynamic" : "fixed"}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                noShowMode: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-noshow-mode"
                          disabled={busy}
                          className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <option value="fixed">Fixed</option>
                          <option value="dynamic">Dynamic</option>
                        </select>
                      </div>
                      <div className="w-full sm:w-28">
                        <Label htmlFor={`queue-noshow-${queue.id}`}>Fixed / fallback (min)</Label>
                        <Input
                          id={`queue-noshow-${queue.id}`}
                          type="number"
                          min="1"
                          max="30"
                          placeholder="5"
                          defaultValue={queue.noShowMinutes ?? 5}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                noShowMinutes: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-noshow"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-28">
                        <Label htmlFor={`queue-noshow-min-${queue.id}`}>Dynamic min</Label>
                        <Input
                          id={`queue-noshow-min-${queue.id}`}
                          type="number"
                          min="1"
                          max="30"
                          placeholder="2"
                          defaultValue={queue.noShowMinMinutes ?? 2}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                noShowMinMinutes: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-noshow-min"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-28">
                        <Label htmlFor={`queue-noshow-max-${queue.id}`}>Dynamic max</Label>
                        <Input
                          id={`queue-noshow-max-${queue.id}`}
                          type="number"
                          min="1"
                          max="30"
                          placeholder="15"
                          defaultValue={queue.noShowMaxMinutes ?? 15}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                noShowMaxMinutes: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-noshow-max"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-32">
                        <Label htmlFor={`queue-recovery-${queue.id}`}>Rejoin window (min)</Label>
                        <Input
                          id={`queue-recovery-${queue.id}`}
                          type="number"
                          min="1"
                          max="60"
                          placeholder="15"
                          defaultValue={queue.recoveryMinutes ?? 15}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                recoveryMinutes: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-recovery-minutes"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-32">
                        <Label htmlFor={`queue-recovery-places-${queue.id}`}>Rejoin places</Label>
                        <Input
                          id={`queue-recovery-places-${queue.id}`}
                          type="number"
                          min="1"
                          max="20"
                          placeholder="2"
                          defaultValue={queue.recoveryPlaces ?? 2}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                recoveryPlaces: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-recovery-places"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-40">
                        <Label htmlFor={`queue-priority-k-${queue.id}`}>Priority every Kth serve</Label>
                        <Input
                          id={`queue-priority-k-${queue.id}`}
                          type="number"
                          min="1"
                          max="10"
                          placeholder="3"
                          defaultValue={queue.priorityEveryK ?? 3}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                priorityEveryK: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-priority-k"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-40">
                        <Label htmlFor={`queue-equiv-${queue.id}`}>Equivalent group</Label>
                        <Input
                          id={`queue-equiv-${queue.id}`}
                          type="text"
                          maxLength={40}
                          placeholder="None"
                          defaultValue={queue.equivalentGroup ?? ""}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                equivalentGroup: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-equivalent-group"
                          disabled={busy}
                        />
                      </div>
                      <div className="w-full sm:w-32">
                        <Label htmlFor={`queue-cap-${queue.id}`}>Max waiting</Label>
                        <Input
                          id={`queue-cap-${queue.id}`}
                          type="number"
                          min="1"
                          max="500"
                          placeholder="No cap"
                          defaultValue={queue.maxWaiting ?? ""}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [queue.id]: {
                                ...(prev[queue.id] || {}),
                                maxWaiting: event.target.value,
                              },
                            }))
                          }
                          data-testid="catalog-queue-cap"
                          disabled={busy}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleSaveQueue(queue)}
                        disabled={busy}
                        data-testid="catalog-queue-save"
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleOpen(queue)}
                        disabled={busy || queue.archived}
                        data-testid="catalog-open-console"
                      >
                        Open console
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleArchive(queue, !queue.archived)}
                        disabled={busy}
                        data-testid="catalog-archive"
                      >
                        {queue.archived ? "Unarchive" : "Archive"}
                      </Button>
                      {queue.archived ? (
                        <span className="self-center text-xs font-semibold text-text-muted">
                          Archived — hidden from students
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <h2 className="font-display text-headline font-semibold tracking-[-0.01em] text-foreground">
              Add to the catalog
            </h2>
            {user?.role === "staff" ? null : (
            <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCreateVenue}>
              <div className="min-w-0 flex-1">
                <Label htmlFor="new-venue-name">New venue</Label>
                <Input
                  id="new-venue-name"
                  value={venueName}
                  onChange={(event) => setVenueName(event.target.value)}
                  placeholder="Venue name"
                  disabled={busy}
                  data-testid="catalog-new-venue-name"
                />
              </div>
              <Button type="submit" disabled={busy || !venueName.trim()} data-testid="catalog-create-venue">
                Add venue
              </Button>
            </form>
            )}
            {user?.role === "staff" && Array.isArray(user.staffQueueIds) && user.staffQueueIds.length > 0 ? null : (
            <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCreateQueue}>
              <div className="min-w-0 flex-1">
                <Label htmlFor="new-queue-name">New queue</Label>
                <Input
                  id="new-queue-name"
                  value={queueName}
                  onChange={(event) => setQueueName(event.target.value)}
                  placeholder="Queue name"
                  disabled={busy}
                  data-testid="catalog-new-queue-name"
                />
              </div>
              <div className="w-full sm:w-40">
                <Label htmlFor="new-queue-venue">Venue</Label>
                <select
                  id="new-queue-venue"
                  value={queueVenueId}
                  onChange={(event) => setQueueVenueId(event.target.value)}
                  disabled={busy || venues.length === 0}
                  data-testid="catalog-new-queue-venue"
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full sm:w-24">
                <Label htmlFor="new-queue-pace">Avg. service (min)</Label>
                <Input
                  id="new-queue-pace"
                  type="number"
                  min="1"
                  max="60"
                  value={queuePace}
                  onChange={(event) => setQueuePace(event.target.value)}
                  disabled={busy}
                  data-testid="catalog-new-queue-pace"
                />
              </div>
              <div className="w-full sm:w-28">
                <Label htmlFor="new-queue-cap">Max waiting</Label>
                <Input
                  id="new-queue-cap"
                  type="number"
                  min="1"
                  max="500"
                  placeholder="No cap"
                  value={queueCap}
                  onChange={(event) => setQueueCap(event.target.value)}
                  disabled={busy}
                  data-testid="catalog-new-queue-cap"
                />
              </div>
              <Button
                type="submit"
                disabled={busy || !queueName.trim() || !queueVenueId}
                data-testid="catalog-create-queue"
              >
                Add queue
              </Button>
            </form>
            )}
          </section>

          {user?.role === "admin" ? (
            <section
              className="rounded-xl border border-border bg-card p-5 shadow-card"
              data-testid="catalog-invite-staff"
            >
              <h2 className="font-display text-headline font-semibold tracking-[-0.01em] text-foreground">
                Invite staff
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                Staff can only manage the venue you assign. Optionally limit them to specific queues; leave all unchecked to allow every queue in the venue. Leave the temporary password empty to generate one. If mail is configured, we also send a reset link.
              </p>
              <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={handleInviteStaff}>
                <div className="min-w-0 flex-1 sm:min-w-[10rem]">
                  <Label htmlFor="staff-name">Name</Label>
                  <Input
                    id="staff-name"
                    value={staffName}
                    onChange={(event) => setStaffName(event.target.value)}
                    placeholder="Cafe staff"
                    disabled={busy}
                    data-testid="catalog-staff-name"
                  />
                </div>
                <div className="min-w-0 flex-1 sm:min-w-[12rem]">
                  <Label htmlFor="staff-email">Email</Label>
                  <Input
                    id="staff-email"
                    type="email"
                    value={staffEmail}
                    onChange={(event) => setStaffEmail(event.target.value)}
                    placeholder="staff@campus.edu"
                    disabled={busy}
                    data-testid="catalog-staff-email"
                  />
                </div>
                <div className="w-full sm:w-44">
                  <Label htmlFor="staff-venue">Venue</Label>
                  <select
                    id="staff-venue"
                    value={staffVenueId}
                    onChange={(event) => {
                      setStaffVenueId(event.target.value);
                      setStaffQueueIds([]);
                    }}
                    disabled={busy || venues.length === 0}
                    data-testid="catalog-staff-venue"
                    className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-full" data-testid="catalog-staff-queues">
                  <p className="text-sm font-medium text-foreground">Queues (optional)</p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Leave all unchecked to allow every queue in this venue.
                  </p>
                  <div className="mt-2 flex flex-col gap-1">
                    {(venues.find((venue) => venue.id === staffVenueId)?.queues || [])
                      .filter((queue) => !queue.archived)
                      .map((queue) => (
                        <label key={queue.id} className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={staffQueueIds.includes(queue.id)}
                            onChange={(event) => toggleInviteQueue(queue.id, event.target.checked)}
                            disabled={busy}
                            data-testid={`catalog-staff-queue-${queue.id}`}
                          />
                          {queue.name}
                        </label>
                      ))}
                  </div>
                </div>
                <div className="w-full sm:w-44">
                  <Label htmlFor="staff-password">Temporary password</Label>
                  <Input
                    id="staff-password"
                    type="text"
                    autoComplete="off"
                    value={staffPassword}
                    onChange={(event) => setStaffPassword(event.target.value)}
                    placeholder="Optional"
                    disabled={busy}
                    data-testid="catalog-staff-password"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={busy || !staffName.trim() || !staffEmail.trim() || !staffVenueId}
                  data-testid="catalog-invite-staff-submit"
                >
                  Invite staff
                </Button>
              </form>
              {staffInvite?.staff ? (
                <p className="mt-3 text-sm text-foreground" data-testid="catalog-staff-invited">
                  Invited {staffInvite.staff.name} ({staffInvite.staff.email}). Temporary password:{" "}
                  <span className="font-medium">{staffInvite.temporaryPassword}</span>
                  {staffInvite.resetSent ? ". A reset link was also sent." : "."} Copy it now — it won’t be shown again.
                </p>
              ) : null}
            </section>
          ) : null}

          {user?.role === "admin" && staffAccounts.length > 0 ? (
            <section
              className="rounded-xl border border-border bg-card p-5 shadow-card"
              data-testid="catalog-staff-list"
            >
              <h2 className="font-display text-headline font-semibold tracking-[-0.01em] text-foreground">
                Staff access
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                Edit a staff member’s queue allow-list. Leave all unchecked to restore access to every queue in their venue.
              </p>
              <ul className="mt-4 flex flex-col gap-4">
                {staffAccounts.map((member) => {
                  const venue = venues.find((row) => row.id === member.staffVenueId);
                  const selected = staffEdits[member.id] ?? member.staffQueueIds ?? [];
                  const queues = (venue?.queues || []).filter((queue) => !queue.archived);
                  return (
                    <li key={member.id} className="rounded-lg border border-border p-3" data-testid="catalog-staff-row">
                      <p className="font-medium text-foreground">
                        {member.name}{" "}
                        <span className="font-normal text-text-secondary">({member.email})</span>
                      </p>
                      <p className="text-xs text-text-muted">
                        {venue?.name || "Venue"} · {selected.length ? selected.length + " queue(s)" : "All queues in the venue"}
                      </p>
                      <div className="mt-2 flex flex-col gap-1">
                        {queues.map((queue) => (
                          <label key={queue.id} className="flex items-center gap-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              checked={selected.includes(queue.id)}
                              onChange={(event) => toggleStaffEditQueue(member, queue.id, event.target.checked)}
                              disabled={busy}
                              data-testid={`catalog-staff-edit-queue-${member.id}-${queue.id}`}
                            />
                            {queue.name}
                          </label>
                        ))}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3"
                        onClick={() => handleSaveStaffQueues(member)}
                        disabled={busy}
                        data-testid={`catalog-staff-save-${member.id}`}
                      >
                        Save access
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </ShellContent>
  );
}
