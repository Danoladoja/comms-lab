import type { NextFunction, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db, usersTable, type User } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const userCache = new WeakMap<Request, User>();

/**
 * Returns the local user for the signed-in Clerk session, JIT-provisioning
 * a row on first sight. The very first user ever provisioned becomes admin.
 * Returns null when not signed in.
 */
export async function getCurrentUser(req: Request): Promise<User | null> {
  const cached = userCache.get(req);
  if (cached) return cached;
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) return null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
  if (existing.length > 0) {
    userCache.set(req, existing[0]);
    return existing[0];
  }

  // JIT provision
  let email = "";
  let name = "";
  try {
    const cu = await clerkClient.users.getUser(clerkUserId);
    email = cu.primaryEmailAddress?.emailAddress ?? cu.emailAddresses[0]?.emailAddress ?? "";
    name = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || email;
  } catch {
    // proceed with blanks; profile can be filled later
  }

  // Advisory lock makes the "first user becomes admin" bootstrap race-free.
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(981431)`);
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(usersTable);
    const role = count === 0 ? "admin" : "learner";
    return tx
      .insert(usersTable)
      .values({ clerkUserId, email, name, role })
      .onConflictDoNothing({ target: usersTable.clerkUserId })
      .returning();
  });

  const user =
    inserted[0] ??
    (await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)))[0];
  userCache.set(req, user);
  return user;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
