/**
 * Finding somebody who already has an account.
 *
 * There are two ways to make a person staff, and only one of them existed in
 * the console. Inviting works for somebody new. For somebody already here —
 * a learner on a cohort who is going to help run the Lab — inviting is refused,
 * correctly: they have an account, and a second invitation to the same inbox
 * would either bounce off Clerk or mint a duplicate.
 *
 * What was missing was the other way. The refusal said "change their role in
 * the list below", and the list below is the staff list, which by design does
 * not contain learners. So the instruction was impossible to follow, and the
 * only route left was the database.
 *
 * Hence this: a search across everybody with an account, so a super admin can
 * find the person and appoint them. Deliberately a search rather than another
 * list — the whole reason People stopped showing every account is that a cohort
 * of fifty buried the four people who run the place.
 */

export type Findable = {
  id: number;
  name?: string | null;
  email?: string | null;
  role: string;
};

/**
 * One character matches most of a cohort, which is not a search result, it is
 * the list we just took away. Two is the point where typing starts to mean
 * something.
 */
export const MIN_SEARCH = 2;

/** Enough to recognise the right person; short enough to stay a shortlist. */
export const MAX_MATCHES = 8;

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Who matches what has been typed, best first.
 *
 * Ranked rather than merely filtered, because the commonest search here is a
 * whole email address pasted out of another window, and that person should be
 * first without the admin having to read a list to check.
 */
export function findPeople<T extends Findable>(
  query: string,
  people: readonly T[],
  options: { limit?: number; exclude?: readonly number[] } = {},
): T[] {
  const q = norm(query);
  if (q.length < MIN_SEARCH) return [];

  const skip = new Set(options.exclude ?? []);
  const limit = options.limit ?? MAX_MATCHES;

  const scored: { person: T; rank: number }[] = [];

  for (const person of people) {
    if (skip.has(person.id)) continue;
    const email = norm(person.email);
    const name = norm(person.name);
    if (!email.includes(q) && !name.includes(q)) continue;

    // Pasted the whole address, then began typing either field, then matched
    // somewhere in the middle.
    const rank =
      email === q ? 0
        : email.startsWith(q) ? 1
          : name.startsWith(q) ? 2
            : 3;
    scored.push({ person, rank });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // A stable, readable tiebreak, so the same search never reorders itself.
    return norm(a.person.name || a.person.email).localeCompare(norm(b.person.name || b.person.email));
  });

  return scored.slice(0, limit).map((s) => s.person);
}

/**
 * What appointing this person would actually do, said before it is done.
 *
 * The two facts an admin needs and cannot see from a name in a list: whether
 * this changes anything at all, and whether it disturbs a place on a programme.
 * It does not — an admin can be enrolled on a cohort, and the enrolment is
 * untouched — but nobody should have to take that on trust while pressing a
 * button on a live account.
 */
export function describeAppointment(person: Findable, nextRole: string): string {
  if (person.role === nextRole) {
    return nextRole === "admin" ? "Already an admin." : "Already a facilitator.";
  }

  const what = nextRole === "admin" ? "an admin" : nextRole === "instructor" ? "a facilitator" : "a learner";

  if (person.role === "learner") {
    return `Makes them ${what}. They keep their place on any programme and everything they have done on it.`;
  }
  if (nextRole === "learner") {
    return "Takes away the console and the teaching area. Their account and their work stay.";
  }
  return `Changes them to ${what}.`;
}
