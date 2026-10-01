import { sliderSummary, pairedChange, type FormQuestion, type GivenAnswer } from "./programForm";

/**
 * Turning a pile of answers into something an impact report can stand on.
 *
 * Two temptations are worth naming, because this file exists to resist both.
 *
 * The first is reporting a number without the count behind it. "Confidence
 * rose to 7.4" is a sentence somebody will put in a funder's report, and if it
 * was computed from three responses out of forty-five it is not evidence, it is
 * an accident. So every figure here travels with how many answers it was made
 * from, and nothing is computed at all where one side is empty.
 *
 * The second is averaging things that are not quantities. A rating's steps are
 * named positions — "Strongly agree" is not 5 — and averaging them is a
 * convention rather than arithmetic. It is a useful convention and this file
 * uses it, because an M&E officer needs one number per question, but it also
 * always returns the full distribution alongside, because "mean 3.1" and "half
 * strongly agreed and half strongly disagreed" are the same mean and entirely
 * different findings.
 */

export type NumericAggregate = {
  shape: "numeric";
  count: number;
  mean: number | null;
  lowest: number | null;
  highest: number | null;
  /** Every value and how many gave it, so a split cohort cannot hide in a mean. */
  spread: { value: number; count: number }[];
};

export type TallyAggregate = {
  shape: "tally";
  /** How many people answered — not how many choices were made. */
  count: number;
  options: { option: string; count: number; pct: number }[];
};

export type WrittenAggregate = {
  shape: "written";
  count: number;
  answers: string[];
  /** Median length in words, which says whether people engaged or escaped. */
  medianWords: number;
};

export type QuestionAggregate = NumericAggregate | TallyAggregate | WrittenAggregate;

function words(text: string): number {
  return text.trim().split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

function median(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/** One question, summarised across everybody who answered it. */
export function aggregate(
  question: FormQuestion,
  given: readonly GivenAnswer[],
): QuestionAggregate {
  const mine = given.filter((g) => g.questionId === question.id);

  if (question.kind === "slider" || question.kind === "rating") {
    const values = mine
      .map((g) => g.number)
      .filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
    const summary = sliderSummary(values);
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return {
      shape: "numeric",
      count: summary.count,
      mean: summary.mean,
      lowest: summary.lowest,
      highest: summary.highest,
      spread: [...counts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([value, count]) => ({ value, count })),
    };
  }

  if (question.kind === "choice" || question.kind === "multi") {
    const options = question.config.options ?? [];
    const picked = new Map<string, number>(options.map((o) => [o, 0]));
    let answered = 0;
    for (const g of mine) {
      const theirs = question.kind === "multi"
        ? (g.choices ?? [])
        : (g.text ?? "").trim() ? [(g.text ?? "").trim()] : [];
      if (theirs.length === 0) continue;
      answered += 1;
      for (const choice of theirs) {
        // Only options the question still offers. An answer to an option since
        // removed is left out rather than silently counted as something else.
        if (picked.has(choice)) picked.set(choice, (picked.get(choice) ?? 0) + 1);
      }
    }
    return {
      shape: "tally",
      count: answered,
      options: options.map((option) => ({
        option,
        count: picked.get(option) ?? 0,
        // Of the people who answered, not of the choices made — on a
        // multi-choice those are different numbers and the first is the one
        // anybody means by "60% said".
        pct: answered === 0 ? 0 : Math.round(((picked.get(option) ?? 0) / answered) * 100),
      })),
    };
  }

  const written = mine
    .map((g) => (g.text ?? "").trim())
    .filter((t) => t.length > 0);
  return {
    shape: "written",
    count: written.length,
    answers: written,
    medianWords: median(written.map(words)),
  };
}

/* ------------------------------------------------------------------ *
 * Before against after
 * ------------------------------------------------------------------ */

export type PairedResult = {
  pairKey: string;
  /** The closing wording, which is the one people read last. */
  prompt: string;
  kind: string;
  before: NumericAggregate | TallyAggregate | null;
  after: NumericAggregate | TallyAggregate | null;
  /** Only for numeric pairs, and only where both sides have answers. */
  movement: ReturnType<typeof pairedChange>;
  note: string;
};

/**
 * Every question asked at both ends, matched by its pair key.
 *
 * Matched on the key rather than on wording, because a question asked before a
 * programme often cannot be worded the same as the one asked after — "how
 * confident do you feel" against "how confident do you feel now" — and matching
 * on text would silently drop exactly the pairs worth having.
 */
export function pairUp(args: {
  beforeQuestions: readonly FormQuestion[];
  afterQuestions: readonly FormQuestion[];
  beforeAnswers: readonly GivenAnswer[];
  afterAnswers: readonly GivenAnswer[];
}): PairedResult[] {
  const beforeByKey = new Map(
    args.beforeQuestions.filter((q) => q.pairKey.trim()).map((q) => [q.pairKey, q]),
  );

  const out: PairedResult[] = [];
  for (const after of args.afterQuestions) {
    const key = after.pairKey.trim();
    if (!key) continue;
    const before = beforeByKey.get(key);
    if (!before) continue;

    const beforeAgg = aggregate(before, args.beforeAnswers);
    const afterAgg = aggregate(after, args.afterAnswers);
    if (beforeAgg.shape === "written" || afterAgg.shape === "written") continue;

    const numeric = beforeAgg.shape === "numeric" && afterAgg.shape === "numeric";
    const movement = numeric
      ? pairedChange({
        before: expand(beforeAgg as NumericAggregate),
        after: expand(afterAgg as NumericAggregate),
      })
      : null;

    out.push({
      pairKey: key,
      prompt: after.prompt,
      kind: after.kind,
      before: beforeAgg,
      after: afterAgg,
      movement,
      note: describeMovement({ movement, beforeAgg, afterAgg }),
    });
  }
  return out;
}

/** The individual values back out of a distribution, for the mean to be taken. */
function expand(agg: NumericAggregate): number[] {
  const values: number[] = [];
  for (const { value, count } of agg.spread) {
    for (let i = 0; i < count; i += 1) values.push(value);
  }
  return values;
}

function describeMovement(args: {
  movement: ReturnType<typeof pairedChange>;
  beforeAgg: QuestionAggregate;
  afterAgg: QuestionAggregate;
}): string {
  if (args.movement) {
    const { before, after, change, beforeCount, afterCount } = args.movement;
    const thin = beforeCount < 5 || afterCount < 5;
    const base = change === 0
      ? `${before} before, ${after} after — unchanged`
      : `${before} before, ${after} after — ${change > 0 ? "up" : "down"} ${Math.abs(change)}`;
    // Said on the figure itself rather than in a footnote, because the figure
    // is what gets copied into a report and the footnote is what gets left
    // behind.
    const caveat = thin
      ? ` (only ${beforeCount} and ${afterCount} answers — too few to lean on)`
      : ` (${beforeCount} and ${afterCount} answers)`;
    return base + caveat;
  }
  if (args.beforeAgg.count === 0 || args.afterAgg.count === 0) {
    return "Nothing to compare yet — one side has no answers.";
  }
  return "Answered on both sides. Compare the two breakdowns below.";
}

/* ------------------------------------------------------------------ *
 * Getting it out of the Lab
 * ------------------------------------------------------------------ */

/**
 * The whole thing as text somebody can paste into a report.
 *
 * Plain text rather than a chart, because the first thing an M&E officer does
 * with this is put it in a document, and because a sentence carries its own
 * caveat where a bar does not.
 */
export function reportText(args: {
  programmeTitle: string;
  enrolled: number;
  beforeFiled: number;
  afterFiled: number;
  pairs: readonly PairedResult[];
  generatedAt: string;
}): string {
  const lines: string[] = [];
  lines.push(`ANANSE COMMS LAB — ${args.programmeTitle.toUpperCase()}`);
  lines.push(`Opening and closing survey, ${args.generatedAt}`);
  lines.push("");
  lines.push(`${args.enrolled} enrolled · ${args.beforeFiled} filed the opening assessment · `
    + `${args.afterFiled} filed the closing survey`);
  lines.push("");

  if (args.pairs.length === 0) {
    lines.push("No question is asked at both ends yet, so there is no change to report.");
    return lines.join("\n");
  }

  lines.push("WHAT CHANGED");
  lines.push("");
  for (const pair of args.pairs) {
    lines.push(pair.prompt);
    lines.push(`  ${pair.note}`);
    lines.push("");
  }

  lines.push("");
  lines.push("Figures are means. Where a question was answered by fewer than five people on "
    + "either side, that is said beside the number — those are not findings.");
  return lines.join("\n");
}

/** The raw answers as a spreadsheet, for anybody who wants to do their own sums. */
export function responsesCsv(args: {
  questions: readonly FormQuestion[];
  rows: readonly { who: string | null; submittedAt: string; answers: readonly GivenAnswer[] }[];
}): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = ["Filed at", "Who", ...args.questions.map((q) => q.prompt)];
  const lines = [header.map(escape).join(",")];

  for (const row of args.rows) {
    const byId = new Map(row.answers.map((a) => [a.questionId, a]));
    const cells = [
      row.submittedAt,
      // Blank rather than "anonymous", so a spreadsheet sorted by this column
      // does not invent a person called Anonymous with thirty responses.
      row.who ?? "",
      ...args.questions.map((q) => {
        const a = byId.get(q.id);
        if (!a) return "";
        if (q.kind === "slider" || q.kind === "rating") return a.number === null || a.number === undefined ? "" : String(a.number);
        if (q.kind === "multi") return (a.choices ?? []).join("; ");
        return a.text ?? "";
      }),
    ];
    lines.push(cells.map((c) => escape(String(c))).join(","));
  }
  return lines.join("\n");
}
