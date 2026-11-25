import "@fontsource-variable/inter";
import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, RouterProvider, createBrowserRouter, useNavigate, useSearchParams } from "react-router";
import { AppShell } from "./components/AppShell.tsx";
import { ThemeProvider } from "./components/ThemeContext.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { ApiError } from "./lib/api.ts";
import { ApplicationsPage } from "./pages/Applications.tsx";
import { LockedPage, NotFoundPage } from "./pages/Locked.tsx";
import { AgendaPage } from "./pages/Agenda.tsx";
import { InboxPage } from "./pages/Inbox.tsx";
import { InsightsPage } from "./pages/Insights.tsx";
import { NetworkPage } from "./pages/Network.tsx";
import { JobWorkspacePage } from "./pages/JobWorkspace.tsx";
import { CalendarPage } from "./pages/Calendar.tsx";
import { MorePage } from "./pages/More.tsx";
import { NotesPage } from "./pages/Notes.tsx";
import { PeoplePage } from "./pages/People.tsx";
import { ReviewPage } from "./pages/Review.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { TodayPage } from "./pages/Today.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

/** Any 423 from the API (locked/wiped) routes to the Locked page. */
function LockWatcher() {
  const navigate = useNavigate();
  useEffect(() => {
    const go = () => location.pathname !== "/locked" && navigate("/locked", { replace: true });
    window.addEventListener("gru:locked", go);
    return () => window.removeEventListener("gru:locked", go);
  }, [navigate]);
  return null;
}

function Root() {
  return (
    <>
      <LockWatcher />
      <AppShell />
    </>
  );
}

/** Jobs now live inside Applications ("Apply today" / "Other jobs"); old links keep working. */
function JobsRedirect() {
  const [p] = useSearchParams();
  const open = p.get("open");
  return <Navigate to={open ? `/jobs/${open}` : "/applications?tab=other"} replace />;
}

const router = createBrowserRouter([
  { path: "/locked", element: <LockedPage /> },
  {
    element: <Root />,
    children: [
      { index: true, element: <TodayPage /> },
      { path: "applications", element: <ApplicationsPage /> },
      { path: "applications/:id", element: <ApplicationsPage /> },
      { path: "review", element: <ReviewPage /> },
      { path: "jobs", element: <JobsRedirect /> },
      { path: "jobs/:id", element: <JobWorkspacePage /> },
      { path: "inbox", element: <InboxPage /> },
      { path: "network", element: <NetworkPage /> },
      { path: "insights", element: <InsightsPage /> },
      { path: "agenda", element: <AgendaPage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "notes", element: <NotesPage /> },
      { path: "people", element: <PeoplePage /> },
      { path: "more", element: <MorePage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Service worker: caches hashed static assets only, never /api (spec section 13).
const secureHost = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
if ("serviceWorker" in navigator && secureHost) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline caching is optional; the app works without it */
    });
  });
}
