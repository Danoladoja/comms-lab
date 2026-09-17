/**
 * What the running code needs the database to have — taken from the code.
 *
 * There was already a check for this. It carried a hand-written list of tables
 * and columns, and the list had not been touched in weeks: it knew nothing
 * about `deadline_extensions` or `session_attendance.live_source`, the two
 * things actually missing on the day a cohort lost their dashboards. A list
 * somebody has to remember to update is a list that is wrong exactly when it
 * matters, because the moment you forget to update it is the moment you also
 * forgot the migration.
 *
 * Its own comment defended being hand-written — "this has to be able to
 * disagree with the code, because disagreeing with the code is the entire thing
 * it is for". That reasoning is inverted. The check exists to compare what the
 * code needs against what the database has; deriving the first half from the
 * code is what makes the comparison honest. Nothing here can fall behind,
 * because adding a table to the schema adds it to the check in the same commit.
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import { isTable, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type TableShape = { table: string; columns: string[] };

/** Every table the code declares, with its columns, as Postgres names them. */
export function expectedShape(): TableShape[] {
  const shapes: TableShape[] = [];
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const config = getTableConfig(value);
    shapes.push({
      table: config.name,
      columns: config.columns.map((c) => c.name),
    });
  }
  return shapes.sort((a, b) => a.table.localeCompare(b.table));
}

export type SchemaGap = {
  missingTables: string[];
  /** "table.column" for each column the code writes and the database lacks. */
  missingColumns: string[];
};

/**
 * What the database is missing, compared with the code.
 *
 * Only ever reports things that are absent. A database holding a column the
 * code no longer uses is not a problem worth stopping anybody over — that is
 * an old migration, not a broken deploy — and treating it as one would make
 * this refuse to start for a reason nobody can act on.
 */
export function compareShape(expected: TableShape[], actual: Map<string, Set<string>>): SchemaGap {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];

  for (const want of expected) {
    const has = actual.get(want.table);
    if (!has) {
      // Its columns are not listed separately: a missing table explains all of
      // them, and forty lines of "deadline_extensions.reason" underneath would
      // bury the one fact that matters.
      missingTables.push(want.table);
      continue;
    }
    for (const column of want.columns) {
      if (!has.has(column)) missingColumns.push(`${want.table}.${column}`);
    }
  }

  return { missingTables, missingColumns };
}

/** Read the database's actual shape. Reads only. */
export async function actualShape(
  database: NodePgDatabase<Record<string, unknown>>,
): Promise<Map<string, Set<string>>> {
  const rows = await database.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `);

  const byTable = new Map<string, Set<string>>();
  for (const row of rows.rows) {
    const set = byTable.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    byTable.set(row.table_name, set);
  }
  return byTable;
}

/** The whole question, asked of a live database. */
export async function schemaGap(
  database: NodePgDatabase<Record<string, unknown>>,
): Promise<SchemaGap> {
  return compareShape(expectedShape(), await actualShape(database));
}
