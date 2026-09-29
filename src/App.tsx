import { lazy, Suspense, Component, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { EmptyState, Loading, ToastProvider } from "./components/ui";
const Layout = lazy(() => import("./components/Layout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Records = lazy(() => import("./pages/Records"));
const RecordDetail = lazy(() =>
  import("./pages/Records").then((m) => ({ default: m.RecordDetail })),
);
const Comparison = lazy(() =>
  import("./pages/Records").then((m) => ({ default: m.Comparison })),
);
const Organizations = lazy(() => import("./pages/Organizations"));
const Profile = lazy(() =>
  import("./pages/Organizations").then((m) => ({
    default: m.OrganizationProfile,
  })),
);
const Documents = lazy(() => import("./pages/Documents"));
const Landing = lazy(() =>
  import("./pages/Public").then((m) => ({ default: m.Landing })),
);
const Login = lazy(() =>
  import("./pages/Public").then((m) => ({ default: m.Login })),
);
const Recovery = lazy(() =>
  import("./pages/Public").then((m) => ({ default: m.Recovery })),
);
const Legal = lazy(() =>
  import("./pages/Public").then((m) => ({ default: m.Legal })),
);
const Onboarding = lazy(() => import("./pages/Onboarding"));
const VerifyEmail = lazy(() =>
  import("./pages/Onboarding").then((m) => ({ default: m.VerifyEmail })),
);
const Team = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Team })),
);
const Roles = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Roles })),
);
const Audit = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Audit })),
);
const Settings = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Settings })),
);
const Notifications = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Notifications })),
);
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="error-state">
        <h1>Let’s reconnect.</h1>
        <p>
          Something interrupted this page. Reload your workspace to continue.
        </p>
        <button
          className="button button-primary"
          onClick={() => window.location.reload()}
        >
          Reload workspace
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Onboarding />} />
                <Route path="/verify" element={<VerifyEmail />} />
                <Route
                  path="/forgot-password"
                  element={<Recovery mode="forgot" />}
                />
                <Route
                  path="/reset-password"
                  element={<Recovery mode="reset" />}
                />
                <Route
                  path="/accept-invitation"
                  element={<Recovery mode="invite" />}
                />
                <Route path="/privacy" element={<Legal type="privacy" />} />
                <Route path="/terms" element={<Legal type="terms" />} />
                <Route path="/app" element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="reports" element={<Dashboard reports />} />
                  <Route path="organizations" element={<Organizations />} />
                  <Route
                    path="discovery"
                    element={<Organizations discovery />}
                  />
                  <Route
                    path="verification"
                    element={<Organizations verification />}
                  />
                  <Route path="organizations/:id" element={<Profile />} />
                  <Route path="profile" element={<Profile own />} />
                  <Route path="documents" element={<Documents />} />
                  <Route path="team" element={<Team />} />
                  <Route path="roles" element={<Roles />} />
                  <Route path="audit" element={<Audit />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="rfqs/:id/compare" element={<Comparison />} />
                  <Route path=":kind" element={<Records />} />
                  <Route path=":kind/:id" element={<RecordDetail />} />
                </Route>
                <Route
                  path="*"
                  element={
                    <EmptyState
                      title="This page took a different path."
                      description="Return to PartnerHub to find your workspace."
                    >
                      <a className="button button-primary" href="/">
                        Back to PartnerHub
                      </a>
                    </EmptyState>
                  }
                />
              </Routes>
            </Suspense>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
