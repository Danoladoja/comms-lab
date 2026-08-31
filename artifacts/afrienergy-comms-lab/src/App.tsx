import { type ReactNode, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { AppLayout } from '@/components/layout/AppLayout';

import Home from '@/pages/Home';
import CourseCatalog from '@/pages/CourseCatalog';
import ProgramDetail from '@/pages/ProgramDetail';
import LearnerDashboard from '@/pages/LearnerDashboard';
import AdminConsole from '@/pages/AdminConsole';
import Teach from '@/pages/Teach';
import CertificatePage from '@/pages/CertificatePage';
import VerifyCertificatePage from '@/pages/VerifyCertificatePage';
import LiveSessions from '@/pages/LiveSessions';
import Classroom from '@/pages/Classroom';
import Recordings from '@/pages/Recordings';
import Certificates from '@/pages/Certificates';
import About from '@/pages/About';
import Partnerships from '@/pages/Partnerships';
import Privacy from '@/pages/Privacy';
import Waitlist from '@/pages/Waitlist';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — empty in dev (Clerk hits dev FAPI directly), auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: '#F97316',
    colorForeground: '#07111E',
    colorMutedForeground: '#5B6470',
    colorDanger: '#C2410C',
    colorBackground: '#FFFFFF',
    colorInput: '#FAF8F3',
    colorInputForeground: '#07111E',
    colorNeutral: '#07111E',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#07111E] font-bold',
    headerSubtitle: 'text-[#5B6470]',
    socialButtonsBlockButtonText: 'text-[#07111E] font-medium',
    formFieldLabel: 'text-[#07111E] font-medium',
    footerActionLink: 'text-[#C2410C] font-semibold hover:text-[#F97316]',
    footerActionText: 'text-[#5B6470]',
    dividerText: 'text-[#5B6470]',
    identityPreviewEditButton: 'text-[#C2410C]',
    formFieldSuccessText: 'text-[#166534]',
    alertText: 'text-[#07111E]',
    logoBox: 'justify-center',
    logoImage: 'h-8',
    socialButtonsBlockButton: 'border border-[#E4DED2] bg-white hover:bg-[#F4F0E8]',
    formButtonPrimary: 'bg-[#F97316] hover:bg-[#EA6D0A] text-[#07111E] font-bold uppercase tracking-wider text-xs',
    formFieldInput: 'border-[#E4DED2] bg-[#FAF8F3] text-[#07111E]',
    footerAction: 'justify-center',
    dividerLine: 'bg-[#E4DED2]',
    alert: 'border-[#E4DED2]',
    otpCodeFieldInput: 'border-[#E4DED2] text-[#07111E]',
    formFieldRow: 'gap-2',
    main: 'gap-6',
  },
};

function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center px-4 py-10"
      style={{ backgroundColor: '#07111E' }}
    >
      {children}
    </div>
  );
}

function SignInPage() {
  return (
    <AuthPageShell>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
    </AuthPageShell>
  );
}

/**
 * Sign-up is by invitation only.
 *
 * An invitation link carries a one-time ticket in its address; that, and only
 * that, is somebody the Lab actually invited. They get the real form. Everyone
 * else arriving at /sign-up — a bookmark, a guessed address, a link from an old
 * post — is told plainly how to join and sent to the waitlist, because an
 * account attached to no programme is what filled the People list with
 * strangers in the first place.
 */
function hasInvitationTicket(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('__clerk_ticket') || params.has('__clerk_invitation_token');
}

function SignUpPage() {
  if (!hasInvitationTicket()) return <InvitationOnlyPage />;
  return (
    <AuthPageShell>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
    </AuthPageShell>
  );
}

function InvitationOnlyPage() {
  return (
    <AuthPageShell>
      <div className="w-full max-w-md rounded-2xl bg-[#F4F0E8] p-8 text-center text-[#07111E]">
        <h1 className="mb-3 font-display text-2xl font-bold">The Lab runs by invitation</h1>
        <p className="text-sm opacity-80">
          Places on each cohort are limited, so accounts are created from an invitation rather than by
          signing up. Join the waitlist and we will write to you when a place opens.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <a
            href={`${basePath}/waitlist`}
            className="rounded-md bg-[#07111E] px-4 py-2.5 text-sm font-semibold text-[#F4F0E8]"
          >
            Join the waitlist
          </a>
          <a href={`${basePath}/sign-in`} className="text-sm underline underline-offset-2">
            Already have an account? Sign in
          </a>
        </div>
      </div>
    </AuthPageShell>
  );
}

/**
 * The homepage belongs to everyone, signed in or not.
 *
 * This used to bounce a signed-in visitor straight to /dashboard. The logo in
 * the header and footer points here, as a logo should, so that redirect quietly
 * made the homepage unreachable for anybody with an account — including the
 * people running the Lab, who have the most reason to look at it.
 *
 * Landing on the dashboard after signing in is still right, and still happens:
 * it is now Clerk's post-sign-in destination rather than a standing rule about
 * what "/" means for the rest of the session.
 */

function Protected({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

// Invalidate the query cache when the signed-in user changes.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        {/* Full-screen routes without Navbar/Footer */}
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/register"><Redirect to="/waitlist" /></Route>
        <Route path="/join"><Redirect to="/waitlist" /></Route>
        <Route path="/login"><Redirect to="/sign-in" /></Route>
        <Route path="/certificate/:id">
          <Protected><CertificatePage /></Protected>
        </Route>
        {/* Public certificate verification — shareable on LinkedIn, no sign-in */}
        <Route path="/verify/:certificateId" component={VerifyCertificatePage} />

        {/* The real classroom: video, quiz, and assignment for one module */}
        <Route path="/classroom/:id">
          <Protected><AppLayout><Classroom /></AppLayout></Protected>
        </Route>

        {/* Public routes with AppLayout */}
        <Route path="/"><AppLayout><Home /></AppLayout></Route>
        <Route path="/courses">
          <AppLayout><CourseCatalog /></AppLayout>
        </Route>
        <Route path="/programs/:id">
          <AppLayout><ProgramDetail /></AppLayout>
        </Route>
        <Route path="/live-sessions">
          <AppLayout><LiveSessions /></AppLayout>
        </Route>
        <Route path="/about">
          <AppLayout><About /></AppLayout>
        </Route>
        <Route path="/partnerships">
          <AppLayout><Partnerships /></AppLayout>
        </Route>
        <Route path="/privacy">
          <AppLayout><Privacy /></AppLayout>
        </Route>
        <Route path="/waitlist">
          <AppLayout><Waitlist /></AppLayout>
        </Route>

        {/* Signed-in routes */}
        <Route path="/dashboard">
          <Protected><AppLayout><LearnerDashboard /></AppLayout></Protected>
        </Route>
        <Route path="/recordings">
          <Protected><AppLayout><Recordings /></AppLayout></Protected>
        </Route>
        <Route path="/certificates">
          <Protected><AppLayout><Certificates /></AppLayout></Protected>
        </Route>
        <Route path="/teach">
          <Protected><AppLayout><Teach /></AppLayout></Protected>
        </Route>
        <Route path="/admin">
          <Protected><AppLayout><AdminConsole /></AppLayout></Protected>
        </Route>

        {/* Catch-all 404 */}
        <Route path="*">
          <AppLayout><NotFound /></AppLayout>
        </Route>
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to the Comms Lab',
          },
        },
        signUp: {
          start: {
            title: 'Join the Comms Lab',
            subtitle: "Africa's learning hub for energy communicators",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
