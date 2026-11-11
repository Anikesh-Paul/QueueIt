import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { MotifIllustration } from "@/components/brand/motif-illustration";
import { useI18n } from "@/context/i18n-context";

/**
 * Route-level error screen (router errorElement). Replaces the blank page a
 * render crash would otherwise leave, with reload and home actions.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const { t } = useI18n();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const chunkFailed = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(String(error?.message || ""));
  if (error && typeof console !== "undefined") console.error(error);

  return (
    <div className="flex min-h-dvh flex-col bg-background px-4 py-6" data-testid="route-error">
      <Wordmark />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
        <MotifIllustration motif="serviceWindow" variant="error" dimmer className="mb-5" />
        <h1 className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
          {status === 404 ? t("notFound.title") : t("error.pageTitle")}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {chunkFailed ? t("error.updated") : t("error.pageBody")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.reload()} data-testid="route-error-reload">
            {t("error.reload")}
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/" reloadDocument>
              {t("error.home")}
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
