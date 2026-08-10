import { cn } from "@/lib/utils";

/**
 * Fixed three-motif set (ADR 0002 / atmosphere B).
 * Decorative only — product UI must work if assets fail to load.
 */
export const MOTIF = {
  /** Quiet service window — auth column/band + full-page error dimmer reuse */
  serviceWindow: "/motifs/quiet-service-window.webp",
  /** Empty waiting hall — empty catalog */
  waitingHall: "/motifs/empty-waiting-hall.webp",
  /** Folded pass still life — empty History */
  foldedPass: "/motifs/folded-pass.webp",
};

/**
 * @param {object} props
 * @param {"serviceWindow"|"waitingHall"|"foldedPass"} props.motif
 * @param {boolean} [props.dimmer] — softer presentation (error/404 reuse)
 * @param {"auth"|"empty"|"error"} [props.variant] — mount size/crop intent
 * @param {string} [props.className]
 */
export function MotifIllustration({
  motif,
  dimmer = false,
  variant = "empty",
  className,
}) {
  const src = MOTIF[motif];
  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
      className={cn(
        "pointer-events-none select-none object-cover",
        variant === "auth" && "h-full w-full",
        variant === "empty" && "mx-auto h-28 w-auto max-w-[11rem] rounded-lg object-cover sm:h-32",
        variant === "error" && "mx-auto h-36 w-auto max-w-[14rem] rounded-lg object-cover sm:h-40",
        dimmer && "opacity-55",
        className
      )}
    />
  );
}
