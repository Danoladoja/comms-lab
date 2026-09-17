/**
 * Where a link inside the app should point.
 *
 * `BASE_PATH` is "/" in this deployment, and pasting that straight in front of
 * a path produces `//admin` — which a browser does not read as "the admin page".
 * It reads it as a protocol-relative URL and goes looking for a *website called
 * admin*. An administrator finishing the Google connection was sent to
 * `//admin?google=error`, got DNS_PROBE_FINISHED_NXDOMAIN, and had no way to
 * find out what had actually gone wrong — the page that would have told them
 * was the page the browser could not reach.
 *
 * One function, so the next link built this way cannot get it wrong again.
 */
export function appPath(basePath: string | null | undefined, path: string): string {
  // Any number of trailing slashes go, so "/" becomes "" and "/app//" becomes
  // "/app". A base that is only slashes is no base at all.
  const base = (basePath ?? "").replace(/\/+$/, "");
  const rest = path.startsWith("/") ? path : `/${path}`;
  return `${base}${rest}`;
}
