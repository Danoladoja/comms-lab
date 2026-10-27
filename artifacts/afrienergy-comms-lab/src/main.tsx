import { createRoot } from 'react-dom/client';

/*
  The certificate's two faces, served with the app rather than fetched from
  Google.

  A certificate is the one page where a missing font is not a cosmetic problem: the
  signatures are set in a signing hand, and when the browser substitutes a
  serif it renders nearly twice as wide and stops looking like a signature at
  all. Anyone on a network that blocks or throttles fonts.gstatic.com — which
  is a normal condition on parts of the continent this Lab serves — would have
  been shown that fallback.
*/
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/archivo/800.css';
import '@fontsource/mrs-saint-delafield/400.css';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
