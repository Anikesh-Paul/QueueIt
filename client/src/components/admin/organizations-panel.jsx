import { useState } from "react";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Global-admin list of organizations: add one, rename one. The main campus is
 * built in and owns every venue that hasn't been moved elsewhere.
 */
export function OrganizationsPanel({ orgs, busy, onCreate, onRename }) {
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState({});

  async function create(event) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    if (await onCreate(clean)) setName("");
  }

  return (
    <section
      aria-labelledby="orgs-title"
      className="mb-4 rounded-xl border border-border bg-card p-5 shadow-card"
      data-testid="catalog-orgs"
    >
      <div className="flex items-start gap-3">
        <Building2 className="mt-1 size-5 shrink-0 text-text-muted" aria-hidden="true" />
        <div>
          <h2 id="orgs-title" className="font-heading text-base font-semibold text-foreground">
            Organizations
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Each organization has its own venues and lines. Students pick theirs on the Queues page once there&apos;s more than one.
          </p>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
        {orgs.map((org) => {
          const key = org.id;
          const draft = drafts[key] ?? org.name;
          const changed = draft.trim() && draft.trim() !== org.name;
          return (
            <li key={key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid="catalog-org" data-slug={org.slug}>
              <div className="min-w-0 flex-1">
                {org.isDefault ? (
                  <p className="text-sm font-medium text-foreground">{org.name}</p>
                ) : (
                  <>
                    <Label htmlFor={`org-name-${key}`} className="sr-only">
                      Name of {org.name}
                    </Label>
                    <Input
                      id={`org-name-${key}`}
                      value={draft}
                      maxLength={60}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      disabled={busy}
                      data-testid="catalog-org-name"
                    />
                  </>
                )}
                <p className="mt-1 text-xs text-text-muted">
                  {org.isDefault ? "Built in · " : ""}
                  {org.venueCount} venue{org.venueCount === 1 ? "" : "s"} · {org.queueCount} line{org.queueCount === 1 ? "" : "s"} · link{" "}
                  <code className="rounded bg-secondary px-1 py-0.5 text-[11px]">/queues?org={org.slug}</code>
                </p>
              </div>
              {!org.isDefault ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || !changed}
                  onClick={() => onRename(org, draft.trim())}
                  data-testid="catalog-org-save"
                >
                  Save name
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={create}>
        <div className="min-w-0 flex-1">
          <Label htmlFor="new-org-name">New organization</Label>
          <Input
            id="new-org-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. City Hospital Annex"
            disabled={busy}
            data-testid="catalog-new-org-name"
          />
        </div>
        <Button type="submit" disabled={busy || !name.trim()} data-testid="catalog-create-org">
          Add organization
        </Button>
      </form>
    </section>
  );
}
