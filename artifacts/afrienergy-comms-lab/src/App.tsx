import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { AppLayout } from '@/components/layout/AppLayout';

import Home from '@/pages/Home';
import CourseCatalog from '@/pages/CourseCatalog';
import CourseDetail from '@/pages/CourseDetail';
import InstructorDashboard from '@/pages/InstructorDashboard';
import CreateCourse from '@/pages/CreateCourse';
import LearnerDashboard from '@/pages/LearnerDashboard';
import QuizInterface from '@/pages/QuizInterface';
import CertificatePage from '@/pages/CertificatePage';
import LiveSessions from '@/pages/LiveSessions';
import EnrollmentFlow from '@/pages/EnrollmentFlow';
import Register from '@/pages/Register';
import Login from '@/pages/Login';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        {/* Full-screen routes without Navbar/Footer */}
        <Route path="/certificate/:id" component={CertificatePage} />
        <Route path="/quiz/:id" component={QuizInterface} />
        <Route path="/enroll/:id" component={EnrollmentFlow} />
        <Route path="/register" component={Register} />
        <Route path="/login" component={Login} />

        {/* Routes with AppLayout */}
        <Route path="/">
          <AppLayout><Home /></AppLayout>
        </Route>
        <Route path="/courses">
          <AppLayout><CourseCatalog /></AppLayout>
        </Route>
        <Route path="/courses/:id">
          {params => <AppLayout><CourseDetail /></AppLayout>}
        </Route>
        <Route path="/instructor">
          <AppLayout><InstructorDashboard /></AppLayout>
        </Route>
        <Route path="/create-course">
          <AppLayout><CreateCourse /></AppLayout>
        </Route>
        <Route path="/dashboard">
          <AppLayout><LearnerDashboard /></AppLayout>
        </Route>
        <Route path="/live-sessions">
          <AppLayout><LiveSessions /></AppLayout>
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
