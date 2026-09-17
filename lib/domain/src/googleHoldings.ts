/**
 * What Google has for a class, said in a way somebody can act on.
 *
 * This exists before any automation does, and deliberately. Building the
 * transcript fetch first would mean building it against a folder that may be
 * empty: a Meet transcript exists only if somebody started one, or if an
 * administrator switched on automatic transcription for the domain. Neither is
 * visible from inside the Lab, and "it found nothing" is indistinguishable from
 * "it is broken" — which is exactly the confusion that cost this cohort three
 * weeks of attendance.
 *
 * So the first thing built is the question, not the answer: ask Google what it
 * holds, and say so plainly. Each verdict below names the next step, because a
 * diagnosis nobody can act on is just a different way of saying no.
 */

export type HoldingsFacts = {
  /** Times this meeting room was used during the window around the class. */
  conferences: number;
  recordings: number;
  /** Transcripts whose document has finished being written. */
  transcriptsReady: number;
  /** Transcripts that were started but have not finished — or did not produce a file. */
  transcriptsUnfinished: number;
  /** Whether the module already has a recording link pasted in by hand. */
  hasRecordingLink: boolean;
  /** Whether somebody has already pasted the transcript into the material box. */
  hasPastedMaterial: boolean;
};

export type HoldingsVerdict = {
  /** One line, the headline answer. */
  headline: string;
  /** What to do about it, or empty when there is nothing to do. */
  advice: string;
  /** Whether this class is in the state automation would need. */
  ready: boolean;
};

export function readHoldings(f: HoldingsFacts): HoldingsVerdict {
  // Nothing at all. Almost always the wrong meeting link on the module rather
  // than a class that did not happen, and worth saying in that order — the link
  // is the thing somebody can check in ten seconds.
  if (f.conferences === 0) {
    return {
      headline: "Google has no record of this room being used around the time of the class.",
      advice: f.hasRecordingLink
        ? "The recording link on this module was pasted in by hand, so the class clearly ran — which means the "
          + "Meet link saved here is not the room it ran in. Correct the meeting link on the module."
        : "Check the meeting link saved on this module is the one the class actually used. If people joined "
          + "from a calendar invite with a different link, Google is being asked about the wrong room.",
      ready: false,
    };
  }

  const both = f.recordings > 0 && f.transcriptsReady > 0;
  if (both) {
    return {
      headline: `Google has the recording and the transcript for this class.`,
      advice: f.hasPastedMaterial
        ? "The transcript is already pasted in here too, so nothing needs doing — but this is the state the "
          + "automation would fill in by itself."
        : "This is the state the automation needs. The transcript could be filled in automatically.",
      ready: true,
    };
  }

  if (f.recordings > 0 && f.transcriptsReady === 0) {
    return {
      headline: "Google has the recording, but no transcript for this class.",
      advice: f.transcriptsUnfinished > 0
        ? "A transcript was started but never finished writing. That usually means the meeting ended very "
          + "shortly after it began, or Google is still working on it — try again in an hour."
        : "Nobody started a transcript for this class. Either the host presses Start transcript each time, or "
          + "an administrator turns on automatic transcription for the domain in the Google Admin console. "
          + "Until one of those happens there is nothing for the app to fetch.",
      ready: false,
    };
  }

  if (f.transcriptsReady > 0) {
    return {
      headline: "Google has the transcript, but no finished recording for this class.",
      advice: "The transcript can be filled in automatically. The replay still has to be pasted in by hand, "
        + "because nobody recorded this one.",
      ready: true,
    };
  }

  return {
    headline: `Google saw this room used, but has neither a recording nor a transcript.`,
    advice: "The class ran, but nothing was captured. Recording and transcription each have to be started — "
      + "by the host in the meeting, or automatically by an administrator setting for the whole domain.",
    ready: false,
  };
}

/**
 * The same question asked of a whole programme.
 *
 * One class tells you about one class. What decides whether the automation is
 * worth building is the pattern: transcripts on every class means switch it on,
 * transcripts on none means fix the Workspace setting first, and transcripts on
 * some means somebody is remembering to press a button and sometimes forgetting
 * — which is the strongest possible argument for automating it.
 */
export function summariseHoldings(verdicts: { ready: boolean }[]): string {
  const total = verdicts.length;
  if (total === 0) return "No past classes to check yet.";
  const ready = verdicts.filter((v) => v.ready).length;

  if (ready === 0) {
    return `None of the ${total} classes checked has a transcript in Google. `
      + "Turning on automatic transcription would have to come before any of this is worth automating.";
  }
  if (ready === total) {
    return `All ${total} classes checked have a transcript in Google. The automation would have everything it needs.`;
  }
  return `${ready} of ${total} classes checked have a transcript in Google. `
    + "The gaps are classes where somebody forgot to start one — which is the case for turning it on automatically.";
}
