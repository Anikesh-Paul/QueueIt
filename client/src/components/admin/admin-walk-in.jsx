import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminWalkIn({ adminActionBusy, adminWalkIn }) {
  const [walkInName, setWalkInName] = useState("");
  const [walkInToken, setWalkInToken] = useState("");

  async function handleWalkIn(event) {
    event.preventDefault();
    if (adminActionBusy) return;
    const name = walkInName.trim();
    if (!name) return;
    const payload = { name };
    if (walkInToken.trim() !== "") {
      payload.tokenNumber = walkInToken.trim();
    }
    const ok = await adminWalkIn(payload);
    if (ok) {
      setWalkInName("");
      setWalkInToken("");
    }
  }

  return (
            <section className="overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card">
              <h2 className="text-label uppercase tracking-wide text-text-muted">Walk-in</h2>
              <form
                className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
                onSubmit={handleWalkIn}
                data-testid="walk-in-form"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-[12rem]">
                  <Label htmlFor="walk-in-name">Name</Label>
                  <Input
                    id="walk-in-name"
                    name="walkInName"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    placeholder="Name at counter"
                    required
                    maxLength={80}
                    disabled={adminActionBusy}
                    data-testid="walk-in-name"
                    className="h-10"
                  />
                </div>
                <div className="flex w-full flex-col gap-1.5 sm:w-28">
                  <Label htmlFor="walk-in-token">Token (optional)</Label>
                  <Input
                    id="walk-in-token"
                    name="walkInToken"
                    type="number"
                    min={1}
                    step={1}
                    value={walkInToken}
                    onChange={(e) => setWalkInToken(e.target.value)}
                    placeholder="Auto"
                    disabled={adminActionBusy}
                    data-testid="walk-in-token"
                    className="h-10"
                  />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  size="lg"
                  disabled={adminActionBusy || !walkInName.trim()}
                  data-testid="walk-in-submit"
                  className="w-full sm:w-auto"
                >
                  {adminActionBusy ? "Working…" : "Add walk-in"}
                </Button>
              </form>
            </section>

  );
}
