/**
 * One-off migration: give every existing enrollment an opaque certificate code.
 *
 * Run this BEFORE `pnpm --filter @workspace/db run push` on a database that
 * already has enrollments, otherwise the NOT NULL constraint on
 * `certificate_code` has nothing to backfill from:
 *
 *   pnpm --filter @workspace/scripts run migrate:certificate-codes -- --prepare
 *   pnpm --filter @workspace/db run push
 *   pnpm --filter @workspace/scripts run migrate:certificate-codes
 *
 * `--prepare` adds the column as nullable and fills it. The second run is a
 * no-op safety net that fills anything created in between and reports the
 * count. Both runs are idempotent.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { generateCertificateCode } from "@workspace/domain";

const PREPARE = process.argv.includes("--prepare");

async function prepareColumn(): Promise<void> {
  await db.execute(sql`
    alter table enrollments
      add column if not exists certificate_code text,
      add column if not exists portfolio_public boolean not null default false
  `);
  console.log("· certificate_code / portfolio_public columns present");
}

async function backfill(): Promise<number> {
  const rows = await db.execute<{ id: number }>(
    sql`select id from enrollments where certificate_code is null order by id`,
  );
  const pending = (rows as unknown as { rows?: { id: number }[] }).rows ?? (rows as unknown as { id: number }[]);
  let filled = 0;

  for (const row of pending) {
    // Retry on the astronomically unlikely collision rather than crashing a
    // migration halfway through.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCertificateCode();
      try {
        await db.execute(
          sql`update enrollments set certificate_code = ${code} where id = ${row.id} and certificate_code is null`,
        );
        filled++;
        break;
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }
  }
  return filled;
}

async function finalise(): Promise<void> {
  await db.execute(sql`
    create unique index if not exists enrollments_certificate_code_unique
      on enrollments (certificate_code)
  `);
  await db.execute(sql`alter table enrollments alter column certificate_code set not null`);
  console.log("· certificate_code is unique and NOT NULL");
}

async function main(): Promise<void> {
  if (PREPARE) await prepareColumn();

  const filled = await backfill();
  console.log(`· backfilled ${filled} enrollment${filled === 1 ? "" : "s"}`);

  if (!PREPARE) await finalise();
  console.log("done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
