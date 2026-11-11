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
  updateAdminQueue,
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
    } catch (err) {
      setError(err.message || "Could not load catalog");
    } finally {
      setLoading(false);
    }
  }, [token]);

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

  async function handleSaveQueue(queue) {
    const draft = drafts[queue.id] || {};
    const name = (draft.name ?? queue.name).trim();
    const pace = Number(draft.averageServiceTime ?? queue.averageServiceTime);
    const capRaw = draft.maxWaiting !== undefined ? draft.maxWaiting : (queue.maxWaiting ?? "");
    await run(() =>
      updateAdminQueue(token, queue.id, {
        name,
        averageServiceTime: pace,
        maxWaiting: capRaw === "" || capRaw == null ? null : Number(capRaw),
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
      <header className="mb-6">
        <h1
          data-testid="catalog-heading"
          className="font-heading text-headline leading-tight text-foreground"
        >
          Catalog
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Add or edit venues and queues. Seeded Cafeteria and Gym stay as the demo starter.
        </p>
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
                    className="rounded-lg border border-border bg-secondary px-3.5 py-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1">
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
                        <Label htmlFor={`queue-pace-${queue.id}`}>Minutes</Label>
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
                  placeholder="Library Annex"
                  disabled={busy}
                  data-testid="catalog-new-venue-name"
                />
              </div>
              <Button type="submit" disabled={busy || !venueName.trim()} data-testid="catalog-create-venue">
                Add venue
              </Button>
            </form>
            )}
            <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCreateQueue}>
              <div className="min-w-0 flex-1">
                <Label htmlFor="new-queue-name">New queue</Label>
                <Input
                  id="new-queue-name"
                  value={queueName}
                  onChange={(event) => setQueueName(event.target.value)}
                  placeholder="Holds desk"
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
                <Label htmlFor="new-queue-pace">Minutes</Label>
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
          </section>
        </div>
      )}
    </ShellContent>
  );
}
