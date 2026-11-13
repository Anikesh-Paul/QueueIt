import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { useApp } from "@/context/app-context";
import {
  fetchAdminCatalog,
  fetchAdminOrganizations,
  fetchConsolePeople,
  inviteOrgAdmin,
  moveStaff,
  setAdminOrganizations,
} from "@/api";
import { isGlobalAdmin } from "@/lib/staff-access";
import { sameOrgs, scopeSummary, sortPeople, toggleOrg, venuesByOrg } from "@/lib/org-access";

const SELECT =
  "h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const CARD = "rounded-xl border border-border bg-card p-5 shadow-card";

function SectionTitle({ icon: Icon, id, title, children }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-1 size-5 shrink-0 text-text-muted" aria-hidden="true" />
      <div>
        <h2 id={id} className="font-heading text-base font-semibold text-foreground">
          {title}
        </h2>
        {children ? <p className="mt-0.5 text-sm text-text-secondary">{children}</p> : null}
      </div>
    </div>
  );
}

/** "All organizations" plus one checkbox per organization. */
function OrgPicker({ idPrefix, orgs, value, onChange, disabled, allowAll = true, legend }) {
  return (
    <fieldset className="mt-3" data-testid={`${idPrefix}-orgs`}>
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {allowAll ? (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={value.length === 0}
              onChange={(event) => event.target.checked && onChange([])}
              disabled={disabled}
              data-testid={`${idPrefix}-org-all`}
            />
            All organizations
          </label>
        ) : null}
        {orgs.map((org) => (
          <label key={org.id} className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={value.includes(org.id)}
              onChange={(event) => onChange(toggleOrg(value, org.id, event.target.checked))}
              disabled={disabled}
              data-testid={`${idPrefix}-org-${org.id}`}
            />
            {org.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Global admins: who manages which organization. Admins can be limited to
 * some organizations (or left with all of them); staff move between venues,
 * which also moves them between organizations. Every change is audited.
 */
export function AdminAccessPage() {
  const { token, user } = useApp();
  const allowed = isGlobalAdmin(user);
  const [people, setPeople] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [venues, setVenues] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [venueDrafts, setVenueDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState({ name: "", email: "", password: "", orgs: [] });
  const [invited, setInvited] = useState(null);

  const load = useCallback(async () => {
    if (!token || !allowed) return;
    setError("");
    try {
      const [peopleData, orgData, catalog] = await Promise.all([
        fetchConsolePeople(token),
        fetchAdminOrganizations(token),
        fetchAdminCatalog(token),
      ]);
      setPeople(peopleData.people || []);
      setOrgs(orgData.organizations || []);
      setVenues(catalog.venues || []);
    } catch (err) {
      setError(err.message || "Couldn't load access");
      setPeople((prev) => prev || []);
    }
  }, [token, allowed]);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => sortPeople(people || []), [people]);
  const admins = sorted.filter((p) => p.role === "admin");
  const staff = sorted.filter((p) => p.role === "staff");
  const venueGroups = useMemo(() => venuesByOrg(venues, orgs), [venues, orgs]);

  if (user && !allowed) return <Navigate to="/admin/catalog" replace />;

  async function run(action, success) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      setNotice(success);
      return true;
    } catch (err) {
      setError(err.message || "Couldn't save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAdmin(person) {
    const next = drafts[person.id] ?? person.adminOrganizationIds ?? [];
    const ok = await run(
      () => setAdminOrganizations(token, person.id, next),
      `${person.name} now manages ${next.length ? next.map((id) => orgs.find((o) => o.id === id)?.name || id).join(", ") : "all organizations"}.`
    );
    if (ok) setDrafts((prev) => ({ ...prev, [person.id]: undefined }));
  }

  async function moveStaffMember(person) {
    const venueId = venueDrafts[person.id];
    if (!venueId) return;
    const venue = venues.find((v) => v.id === venueId);
    const ok = await run(() => moveStaff(token, person.id, venueId), `${person.name} moved to ${venue?.name || "the new venue"}.`);
    if (ok) setVenueDrafts((prev) => ({ ...prev, [person.id]: undefined }));
  }

  async function submitInvite(event) {
    event.preventDefault();
    setInvited(null);
    let result = null;
    const ok = await run(async () => {
      result = await inviteOrgAdmin(token, {
        name: invite.name.trim(),
        email: invite.email.trim(),
        temporaryPassword: invite.password.trim() || undefined,
        organizationIds: invite.orgs,
      });
    }, "");
    if (ok && result) {
      setInvited(result);
      setInvite({ name: "", email: "", password: "", orgs: [] });
    }
  }

  return (
    <>
      <PageToolbar tier="admin" title="Access" meta="Global admins only · every change is in the audit log" />
      <ShellContent tier="admin" className="max-w-4xl">
        <header className="mb-5">
          <h1 className="font-heading text-headline leading-tight text-foreground" data-testid="access-heading">
            Who manages what
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Limit an admin to one or more organizations. They&apos;ll only see and manage those organizations&apos; venues, lines, staff, notices, analytics, shifts and audit log. Admins with all organizations can also manage organizations and access.
          </p>
        </header>

        {error ? (
          <Alert variant="destructive" className="mb-4" data-testid="access-error">
            {error}
          </Alert>
        ) : null}
        <p role="status" className={notice ? "mb-4 rounded-lg bg-primary-muted px-4 py-2 text-sm text-primary" : "sr-only"} data-testid="access-notice">
          {notice}
        </p>

        {people === null ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading access">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <section aria-labelledby="access-admins-title" className={CARD} data-testid="access-admins">
              <SectionTitle icon={ShieldCheck} id="access-admins-title" title="Admins">
                Changes apply on their next click; nobody has to sign in again.
              </SectionTitle>
              <ul className="mt-4 flex flex-col gap-3">
                {admins.map((person) => {
                  const self = person.id === user?.id;
                  const current = person.adminOrganizationIds || [];
                  const draft = drafts[person.id] ?? current;
                  const changed = !sameOrgs(draft, current);
                  return (
                    <li key={person.id} className="rounded-lg border border-border p-4" data-testid="access-admin-row" data-email={person.email}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium text-foreground">
                          {person.name} <span className="font-normal text-text-secondary">({person.email})</span>
                        </p>
                        <span
                          className={
                            person.scope === "global"
                              ? "rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning-ink"
                              : "rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-semibold text-info-ink"
                          }
                          data-testid="access-admin-scope"
                        >
                          {scopeSummary(person)}
                        </span>
                      </div>
                      {self ? (
                        <p className="mt-2 text-sm text-text-secondary">That&apos;s you. Another global admin can change your access.</p>
                      ) : (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                          <OrgPicker
                            idPrefix={`access-admin-${person.id}`}
                            legend={`Organizations ${person.name} manages`}
                            orgs={orgs}
                            value={draft}
                            onChange={(next) => setDrafts((prev) => ({ ...prev, [person.id]: next }))}
                            disabled={busy}
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => saveAdmin(person)}
                            disabled={busy || !changed}
                            data-testid="access-admin-save"
                          >
                            Save access
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section aria-labelledby="access-invite-title" className={CARD} data-testid="access-invite">
              <SectionTitle icon={UserPlus} id="access-invite-title" title="Add an organization admin">
                They can sign in right away with the temporary password. Leave it empty to generate one.
              </SectionTitle>
              <form className="mt-4 flex flex-col gap-3" onSubmit={submitInvite}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="access-invite-name">Name</Label>
                    <Input
                      id="access-invite-name"
                      value={invite.name}
                      onChange={(e) => setInvite((prev) => ({ ...prev, name: e.target.value }))}
                      disabled={busy}
                      data-testid="access-invite-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="access-invite-email">Email</Label>
                    <Input
                      id="access-invite-email"
                      type="email"
                      value={invite.email}
                      onChange={(e) => setInvite((prev) => ({ ...prev, email: e.target.value }))}
                      disabled={busy}
                      data-testid="access-invite-email"
                    />
                  </div>
                  <div>
                    <Label htmlFor="access-invite-password">Temporary password</Label>
                    <Input
                      id="access-invite-password"
                      autoComplete="off"
                      value={invite.password}
                      placeholder="Optional"
                      onChange={(e) => setInvite((prev) => ({ ...prev, password: e.target.value }))}
                      disabled={busy}
                      data-testid="access-invite-password"
                    />
                  </div>
                </div>
                <OrgPicker
                  idPrefix="access-invite"
                  legend="Organizations they manage"
                  orgs={orgs}
                  value={invite.orgs}
                  allowAll={false}
                  onChange={(next) => setInvite((prev) => ({ ...prev, orgs: next }))}
                  disabled={busy}
                />
                <div>
                  <Button
                    type="submit"
                    disabled={busy || !invite.name.trim() || !invite.email.trim() || !invite.orgs.length}
                    data-testid="access-invite-submit"
                  >
                    Add admin
                  </Button>
                </div>
              </form>
              {invited?.admin ? (
                <p className="mt-3 text-sm text-foreground" data-testid="access-invited">
                  Added {invited.admin.name} ({invited.admin.email}). Temporary password:{" "}
                  <span className="font-medium">{invited.temporaryPassword}</span>
                  {invited.resetSent ? ". A reset link was also sent." : "."} Copy it now — it won&apos;t be shown again.
                </p>
              ) : null}
            </section>

            <section aria-labelledby="access-staff-title" className={CARD} data-testid="access-staff">
              <SectionTitle icon={Users} id="access-staff-title" title="Staff">
                Staff belong to the organization of their venue. Moving them to another venue resets their queue list to the whole venue.
              </SectionTitle>
              {staff.length ? (
                <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                  {staff.map((person) => {
                    const draft = venueDrafts[person.id] ?? person.staffVenueId ?? "";
                    return (
                      <li key={person.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-end" data-testid="access-staff-row" data-email={person.email}>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">
                            {person.name} <span className="font-normal text-text-secondary">({person.email})</span>
                          </p>
                          <p className="text-xs text-text-muted" data-testid="access-staff-scope">
                            {scopeSummary(person)}
                          </p>
                        </div>
                        <div className="w-full sm:w-60">
                          <Label htmlFor={`access-staff-venue-${person.id}`}>Venue</Label>
                          <select
                            id={`access-staff-venue-${person.id}`}
                            className={SELECT}
                            value={draft}
                            onChange={(e) => setVenueDrafts((prev) => ({ ...prev, [person.id]: e.target.value }))}
                            disabled={busy}
                            data-testid="access-staff-venue"
                          >
                            {venueGroups.map((group) => (
                              <optgroup key={group.id} label={group.name}>
                                {group.venues.map((venue) => (
                                  <option key={venue.id} value={venue.id}>
                                    {venue.name}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => moveStaffMember(person)}
                          disabled={busy || !draft || draft === person.staffVenueId}
                          data-testid="access-staff-move"
                        >
                          Move
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-text-secondary">No staff yet. Invite them from the Catalog.</p>
              )}
            </section>
          </div>
        )}
      </ShellContent>
    </>
  );
}
