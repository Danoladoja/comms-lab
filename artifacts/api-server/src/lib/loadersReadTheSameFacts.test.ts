import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The admin's loader must read every fact the learner's loader reads.
 *
 * There are two loaders. `progress.ts` answers "where is this one person",
 * `cohortProgress.ts` answers "where is everybody" — and both hand what they
 * find to the same `computeProgress`. Sharing the rules was supposed to make
 * them incapable of disagreeing, and the comment at the top of
 * cohortProgress.ts said so out loud.
 *
 * It was not true, and the way it stopped being true is worth guarding rather
 * than just fixing. Sharing the rules guarantees the two screens apply the same
 * reasoning; it guarantees nothing at all about their being given the same
 * facts. When simulation modules arrived, the learner's loader learned to read
 * a module's kind, the Studio exercises somebody had been sent and who had
 * walked into a group session. The admin's loader did not. The rules then ran
 * perfectly on half an account: every simulation module read as an ordinary
 * class, so the admin's screen reported forty-five people absent from a lecture
 * that was never scheduled while their own dashboards showed the module
 * finished. Nothing failed. Nothing logged. It was found by a learner saying so.
 *
 * Two facts would have caught it on the day it was introduced, and neither
 * needs a database: which tables each loader reads, and which columns it names.
 * So that is what this checks. It is a blunt instrument — it reads the source
 * text — and it is deliberately blunt, because the subtle version is the one
 * that drifted.
 *
 * If this fails, the fix is almost never to edit this test. It is that a column
 * or table was added to the single-learner loader and not to the cohort one,
 * and some admin screen is now quietly a version behind.
 */

const read = (file: string) =>
  readFileSync(path.join(__dirname, file), "utf8");

/** Every `somethingTable.someColumn` the file names. */
function columnsNamed(source: string): Set<string> {
  const found = new Set<string>();
  for (const m of source.matchAll(/\b(\w+Table)\.(\w+)/g)) found.add(`${m[1]}.${m[2]}`);
  return found;
}

/** Every table it imports from the database package. */
function tablesImported(source: string): Set<string> {
  const block = source.match(/import\s*\{([\s\S]*?)\}\s*from\s*"@workspace\/db"/);
  const found = new Set<string>();
  if (!block) return found;
  for (const m of block[1].matchAll(/\b(\w+Table)\b/g)) found.add(m[1]);
  return found;
}

const learnerLoader = read("progress.ts");
const cohortLoader = read("cohortProgress.ts");

describe("the two progress loaders", () => {
  it("read the same tables", () => {
    const mine = tablesImported(learnerLoader);
    const theirs = tablesImported(cohortLoader);

    // Sanity: if the shapes above stop matching the files, this test would
    // pass by finding nothing at all, which is the one way it could lie.
    expect(mine.size).toBeGreaterThan(5);

    const missing = [...mine].filter((t) => !theirs.has(t));
    expect(missing, `cohortProgress.ts does not read: ${missing.join(", ")}`).toEqual([]);
  });

  it("name the same columns", () => {
    const mine = columnsNamed(learnerLoader);
    const theirs = columnsNamed(cohortLoader);

    expect(mine.size).toBeGreaterThan(20);

    const missing = [...mine].filter((c) => !theirs.has(c)).sort();
    expect(missing, `cohortProgress.ts never names: ${missing.join(", ")}`).toEqual([]);
  });
});
