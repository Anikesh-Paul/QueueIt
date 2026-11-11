import { cn } from "@/lib/utils";

/** Quiet empty state: a short title, one helpful next step, optional action. */
export function EmptyState({ icon: Icon, title, hint, action, className, testId }) {
  return (
    <div data-testid={testId} className={cn("flex flex-col items-center rounded-md border border-dashed border-border-strong px-5 py-8 text-center", className)}>
      {Icon ? (
        <span className="mb-3 grid size-10 place-items-center rounded-full bg-secondary text-text-secondary" aria-hidden="true">
          <Icon className="size-5" />
        </span>
      ) : null}
      <p className="font-medium text-foreground">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-sm text-text-secondary">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
