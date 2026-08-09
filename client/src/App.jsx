import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { AppProvider, useApp } from "@/context/app-context";
import { AppShell } from "@/components/shell/app-shell";
import { Wordmark } from "@/components/brand/wordmark";
import {
  HomeRedirect,
  RequireAdmin,
  RequireAuth,
  RequireGuest,
  RequireUser,
} from "@/routes/guards";
import { QueuesPage } from "@/pages/queues-page";
import { StatusPage } from "@/pages/status-page";
import { HistoryPage } from "@/pages/history-page";
import { AdminConsolePage } from "@/pages/admin-console-page";
import { AnalyticsPage } from "@/pages/analytics-page";
import { LoginPage, NotFoundPage, RegisterPage } from "@/pages/auth-pages";

const router = createBrowserRouter([
  {
    // The boot gate lives INSIDE the router so the boot screen may render
    // router primitives (the wordmark's Link). Above the router it crashed on
    // any hard reload while a session was stored: Link has no Router context
    // until RouterProvider mounts, and the boot screen painted before that.
    element: <BootGate />,
    children: [
      {
        element: <RequireGuest />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
        ],
      },
      {
        element: <RequireAuth />,
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
                  { path: "queues/:queueId", element: <AdminConsolePage /> },
                  { path: "queues/:queueId/analytics", element: <AnalyticsPage /> },
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
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
      <Wordmark to="/login" />
      <p className="text-sm text-text-muted" aria-live="polite">
        Restoring session…
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
    <AppProvider>
      <AppRoot />
    </AppProvider>
  );
}