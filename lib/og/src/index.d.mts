// Hand-written types for the two plain-JavaScript modules behind this package.
// They are kept as .mjs deliberately — a PNG encoder and a meta-tag injector
// with no dependencies are not improved by a build step.

export type Certificate = {
  certificateId: string;
  learnerName: string;
  programTitle: string;
  issuedAt?: string;
  [key: string]: unknown;
};

/** Candidate API base URLs to try, in order, when looking a certificate up. */
export function resolveApiBases(req?: unknown): string[];

/** The certificate behind a code, or null when it is invalid or unearned. */
export function fetchCertificate(
  certificateId: string,
  apiBases: string[],
): Promise<Certificate | null>;

/** Open Graph tags describing one certificate. */
export function buildCertificateMeta(
  cert: Certificate,
  origin: string,
  base: string,
): Record<string, string>;

/** Replace the shell's generic meta tags with the ones given. */
export function injectMeta(html: string, meta: Record<string, string>): string;

/** Escape a value for safe interpolation into HTML attributes. */
export function escapeHtml(value: string): string;

/** The public origin a request arrived on, honouring forwarding headers. */
export function requestOrigin(req: unknown): string;

/** A 1200x630 PNG of the certificate, for link previews. */
export function renderCertificateImage(cert: Certificate): Buffer;
