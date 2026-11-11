import { lazy, Suspense } from "react";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { AppProvider, useApp } from "@/context/app-context";
import { I18nProvider, useI18n } from "@/context/i18n-context";
import { AppShell } from "@/components/shell/app-shell";
import { Wordmark } from "@/components/brand/wordmark";
import {
  HomeRedirect,
  JoinSessionGate,
  RequireAdmin,
  RequireLoggedOut,
  RequireShellAccess,
  RequireUser,
} from "@/routes/guards";
import { QueuesPage } from "@/pages/queues-page";
import { JoinPage } from "@/pages/join-page";
import { StatusPage } from "@/pages/status-page";
import { HistoryPage } from "@/pages/history-page";
import { LoginPage, NotFoundPage, RegisterPage } from "@/pages/auth-pages";
import { ForgotPasswordPage, ResetPasswordPage } from "@/pages/password-reset-pages";
import { KioskPage } from "@/pages/kiosk-page";

const AdminConsolePage = lazy(() =>
  import("@/pages/admin-console-page").then((mod) => ({ default: mod.AdminConsolePage }))
);
const AnalyticsPage = lazy(() =>
  import("@/pages/analytics-page").then((mod) => ({ default: mod.AnalyticsPage }))
);
const AdminCatalogPage = lazy(() =>
  import("@/pages/admin-catalog-page").then((mod) => ({ default: mod.AdminCatalogPage }))
);
const PosterPage = lazy(() =>
  import("@/pages/poster-page").then((mod) => ({ default: mod.PosterPage }))
);
const CampusAnalyticsPage = lazy(() =>
  import("@/pages/campus-analytics-page").then((mod) => ({ default: mod.CampusAnalyticsPage }))
);

/** Calm placeholder while a lazy admin route chunk loads. */
function RouteFallback() {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 py-24"
      data-testid="route-fallback"
    >
      <p className="text-sm text-text-muted" aria-live="polite">
        {t("common.loading")}
      </p>
    </div>
  );
}

function AdminRouteOutlet() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    // The boot gate lives INSIDE the router so the boot screen may render
    // router primitives (the wordmark's Link). Above the router it crashed on
    // any hard reload while a session was stored: Link has no Router context
    // until RouterProvider mounts, and the boot screen painted before that.
    element: <BootGate />,
    children: [
      { path: "/kiosk/:queueId", element: <KioskPage /> },
      {
        element: <RequireLoggedOut />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> },
          { path: "/reset-password", element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <JoinSessionGate />,
        children: [
          {
            element: <AppShell />,
            children: [{ path: "join/:queueId", element: <JoinPage /> }],
          },
        ],
      },
      {
        // Printable poster: no app shell so it prints as a clean A4 sheet.
        element: <RequireShellAccess />,
        children: [
          {
            path: "admin/queues/:queueId/poster",
            element: <RequireAdmin />,
            children: [
              {
                element: <AdminRouteOutlet />,
                children: [{ index: true, element: <PosterPage /> }],
              },
            ],
          },
        ],
      },
      {
        element: <RequireShellAccess />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <HomeRedirect /> },
              { path: "queues", element: <QueuesPage /> },
              {
                element: <RequireUser />,
                children: [
                  { path: "status", element: <StatusPage /> },
                  { path: "history", element: <HistoryPage /> },
                ],
              },
              {
                path: "admin",
                element: <RequireAdmin />,
                children: [
                  {
                    element: <AdminRouteOutlet />,
                    children: [
                      { path: "catalog", element: <AdminCatalogPage /> },
                      { path: "analytics", element: <CampusAnalyticsPage /> },
                      { path: "queues/:queueId", element: <AdminConsolePage /> },
                      { path: "queues/:queueId/analytics", element: <AnalyticsPage /> },
                    ],
                  },
                ],
              },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

/** Calm session-restore surface shown while the router boots. */
function BootScreen() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
      <Wordmark to="/login" />
      <p className="text-sm text-text-muted" aria-live="polite">
        {t("boot.restoring")}
      </p>
    </div>
  );
}

/** Route-level gate: render the boot surface until the session is restored. */
function BootGate() {
  const { booting } = useApp();
  if (booting) return <BootScreen />;
  return <Outlet />;
}

function AppRoot() {
  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <AppRoot />
      </AppProvider>
    </I18nProvider>
  );
}
