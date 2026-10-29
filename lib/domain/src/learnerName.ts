/**
 * The name the Lab prints on a certificate, and how it tells a real one from a
 * stand-in.
 *
 * Clerk does not ask for a first or last name at sign-up, so for a good many
 * learners the only thing the Lab knows on their first visit is an email
 * address. That address was written into the name column as a fallback — which
 * is reasonable for a People list, where identifying somebody by their address
 * is useful — and then printed, at 48pt, in the middle of their certificate.
 * Graduates were being handed a document made out to an inbox.
 *
 * The fallback stays, because an admin looking at a register still needs
 * something to read. What changes is that it is never mistaken for a name:
 * everything that prints a name asks here first, and a certificate with no
 * name to print is withheld rather than issued wrong.
 */

/** The longest name that still fits the line on the sheet. */
export const MAX_LEARNER_NAME = 80;

/** No person's name has an @ in it; every email address does. */
function looksLikeAnAddress(value: string): boolean {
  return value.includes("@");
}

/**
 * The name to print, or null when the Lab does not actually know it.
 *
 * Null for a blank, for an address, for the email fallback still sitting in the
 * name column, and for a string with no letter in it at all — a certificate
 * reading "." or "123" is not better than one that waits.
 */
export function certificateName(person: {
  name?: string | null;
  email?: string | null;
}): string | null {
  const name = (person.name ?? "").trim();
  if (name.length < 2) return null;
  if (looksLikeAnAddress(name)) return null;
  if (!/\p{L}/u.test(name)) return null;

  const email = (person.email ?? "").trim();
  if (email && name.toLowerCase() === email.toLowerCase()) return null;

  return name;
}

/**
 * Why a name a learner typed cannot be used, or null when it can.
 *
 * Returned as a sentence because it is read on screen at the moment somebody
 * is stopped. The server enforces it; the browser shows the same sentence
 * before the button is pressed, from this same function.
 */
export function learnerNameProblem(value: string): string | null {
  const name = value.trim();
  if (name.length === 0) return "Type the name you would like on your certificate.";
  if (name.length < 2) return "That is too short to be a name.";
  if (name.length > MAX_LEARNER_NAME) {
    return `A name has to fit on the certificate — ${MAX_LEARNER_NAME} characters at most.`;
  }
  if (looksLikeAnAddress(name)) {
    return "That looks like an email address. Type the name you want printed instead.";
  }
  if (!/\p{L}/u.test(name)) return "A name needs at least one letter in it.";
  return null;
}
