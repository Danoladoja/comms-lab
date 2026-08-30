// Open Graph metadata and certificate preview images.
//
// Shared because two servers need it: the API server, which serves the built
// web app in production, and the web app's own dev server. A PNG encoder is
// not something to keep two copies of.
export {
  buildCertificateMeta,
  escapeHtml,
  fetchCertificate,
  injectMeta,
  requestOrigin,
  resolveApiBases,
} from './og.mjs';
export { renderCertificateImage } from './og-image.mjs';
