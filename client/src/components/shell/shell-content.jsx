import { cn } from "@/lib/utils";

/**
 * Content width tier for the hybrid shell.
 * Student surfaces (Queues, Status, History, Guest later): max-w-3xl.
 * Admin surfaces (console, Analytics): max-w-6xl.
 * Auth keeps its own layout — do not wrap auth in this.
 */
export function ShellContent({ tier = "student", className, children, as: Comp = "div" }) {
  return (
    <Comp
      data-shell-tier={tier}
      className={cn(
        "mx-auto w-full px-4 py-8 sm:px-6 sm:py-12",
        tier === "admin" ? "max-w-6xl" : "max-w-3xl",
        className
      )}
    >
      {children}
    </Comp>
  );
}
