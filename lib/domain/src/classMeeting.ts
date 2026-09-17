/**
 * The class's meeting, as a calendar event.
 *
 * Why the app should own this at all, rather than an admin pasting a link in:
 * for three weeks a cohort's attendance was empty, and the cause was that the
 * link in the Lab and the link in the calendar invite were two different things
 * maintained by hand. The app's one 404'd, everyone used the calendar's, and the
 * app saw nobody in the room. No threshold could have fixed that — the two were
 * only ever as aligned as whoever last pasted them.
 *
 * Creating the event here makes them one object. The link the Lab shows is the
 * link the event carries, because it came from the event. They cannot drift,
 * because there is no second thing to drift from.
 *
 * Everything in this file is a pure function of what Google returned or what a
 * module says, so it can be tested against the shapes the API actually produces
 * rather than hoped about.
 */

/** When the class runs, as an event needs it. */
export function eventWindow(startsAt: Date, durationMins: number): { startIso: string; endIso: string } {
  const start = startsAt.getTime();
  // A module with a nonsense length would otherwise create an event that ends
  // before it begins, which Google rejects with a message about nothing.
  const minutes = Number.isFinite(durationMins) && durationMins > 0 ? durationMins : 60;
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + minutes * 60_000).toISOString(),
  };
}

/**
 * What the event says on the calendar.
 *
 * The programme's name is in the title because the organiser's calendar holds
 * every cohort at once, and "Energy Fundamentals" alone is ambiguous by the
 * second programme. The description points back at the Lab, because somebody
 * looking at this event in six months needs to know what made it.
 */
export function eventSummary(programmeTitle: string, moduleTitle: string): string {
  const programme = programmeTitle.trim();
  const module = moduleTitle.trim() || "Class";
  return programme ? `${programme} — ${module}` : module;
}

export function eventDescription(args: { moduleUrl: string | null }): string {
  const lines = [
    "Created by the Ananse Comms Lab.",
    "",
    "The joining link on this event is the same one the Lab shows learners — "
      + "changing or removing it here will stop attendance being recorded.",
  ];
  if (args.moduleUrl) {
    lines.push("", `This class in the Lab: ${args.moduleUrl}`);
  }
  return lines.join("\n");
}

/**
 * The joining link Google attached, if it has finished attaching one.
 *
 * Conferences are minted asynchronously: the event comes back immediately with
 * a request marked `pending` and no link at all, and the link appears on a later
 * read. Treating a pending event as a failure would have an admin pressing the
 * button again and creating a second meeting for the same class.
 */
export function meetLinkFrom(conferenceData: unknown): string | null {
  const data = conferenceData as {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  } | null | undefined;

  for (const entry of data?.entryPoints ?? []) {
    if (entry.entryPointType !== "video") continue;
    const uri = (entry.uri ?? "").trim();
    if (uri.startsWith("https://meet.google.com/")) return uri;
  }
  return null;
}

/** Where Google has got to in making the conference. */
export type ConferenceProgress = "ready" | "pending" | "failed" | "none";

export function conferenceProgress(conferenceData: unknown): ConferenceProgress {
  const data = conferenceData as {
    createRequest?: { status?: { statusCode?: string } };
  } | null | undefined;

  if (meetLinkFrom(conferenceData)) return "ready";

  const code = data?.createRequest?.status?.statusCode;
  if (code === "pending") return "pending";
  if (code === "failure") return "failed";
  return data ? "pending" : "none";
}

/** Why this module cannot have a meeting made for it, if it cannot. */
export function meetingProblem(facts: {
  startsAt: Date | null;
  calendarConnected: boolean;
  /** Whether the stored connection was granted the calendar permission. */
  calendarAuthorised: boolean;
  existingMeetUrl: string | null;
}): string | null {
  if (!facts.calendarConnected) {
    return "Google is not connected. Connect it on the Recordings page first.";
  }
  if (!facts.calendarAuthorised) {
    // The likeliest failure by far, and the one with a specific remedy: Google
    // only grants a new permission at the consent screen, so a connection made
    // before this existed has everything except this.
    return "This Google connection was made before the Lab could create meetings, so it has not been "
      + "given permission to. Press Reconnect on the Recordings page — it is the same button, and the "
      + "consent screen will ask for one extra permission.";
  }
  if (!facts.startsAt) {
    return "Give this module a date and time first — a meeting needs to be at a moment.";
  }
  if (facts.existingMeetUrl && facts.existingMeetUrl.trim().length > 0) {
    return "This module already has a meeting link. Clear it first if you want the Lab to make a new one — "
      + "but if learners already have the old one in their calendars, changing it is how a cohort ends up "
      + "in an empty room.";
  }
  return null;
}
