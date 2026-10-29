import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { certificateName, isCertificateFinish, learnerNameProblem } from "@workspace/domain";
// The runtime validator Orval derives from the operation, not the component
// type of the same shape — the component only produces a TypeScript interface.
import { SetMyCertificateFinishBody, SetMyNameBody } from "@workspace/api-zod";
import { currentRole, getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

router.get("/me", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    id: user.id,
    clerkUserId: user.clerkUserId,
    email: user.email,
    name: user.name,
    /*
      The name a certificate can actually carry, or an empty string when the
      Lab does not know it. `name` above may be the email address Clerk left
      behind, which is serviceable on a register and was a disaster on a
      certificate. Sent separately so the browser can ask for a name without
      having to work out for itself whether the one it holds is real.
    */
    printableName: certificateName(user) ?? "",
    // Null until they have opened a certificate and chosen a finish.
    certificateFinish: user.certificateFinish,
    // The effective role, not the stored one. A super admin was being sent
    // their database row, and every gate in the browser compares against
    // "admin" — so an appointed super admin was locked out of the console they
    // had just been given. The founder, whose row says admin, has the same
    // problem in reverse.
    role: (await currentRole(req)) ?? user.role,
  });
});

/**
 * The name I want printed on my certificate.
 *
 * Mine alone to set, and it only ever touches my own row: the id comes from the
 * session, never from the request, so this cannot be pointed at somebody else's
 * sheet.
 */
router.put("/me/name", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = SetMyNameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A name is required" });
    return;
  }

  // The same sentence the browser has already shown them, from the same
  // function, so a refusal here is never a different refusal from the one they
  // read before pressing the button.
  const problem = learnerNameProblem(parsed.data.name);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ name: parsed.data.name.trim() })
    .where(eq(usersTable.id, user.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "No such account" });
    return;
  }

  res.json({
    id: updated.id,
    clerkUserId: updated.clerkUserId,
    email: updated.email,
    name: updated.name,
    printableName: certificateName(updated) ?? "",
    certificateFinish: updated.certificateFinish,
    role: (await currentRole(req)) ?? updated.role,
  });
});

/**
 * Which of the two sheets my certificates are printed on.
 *
 * Writing this is also the Lab's record that the learner opened their own
 * certificate and looked at it: the page shows both finishes with their real
 * name and programme on them, and will not offer a download until one of them
 * has been chosen. That is the point of the step, and the reason the column
 * starts null rather than defaulted.
 */
router.put("/me/certificate-finish", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = SetMyCertificateFinishBody.safeParse(req.body);
  if (!parsed.success || !isCertificateFinish(parsed.data.finish)) {
    res.status(400).json({ error: "Choose one of the finishes the Lab issues" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ certificateFinish: parsed.data.finish })
    .where(eq(usersTable.id, user.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "No such account" });
    return;
  }

  res.json({
    id: updated.id,
    clerkUserId: updated.clerkUserId,
    email: updated.email,
    name: updated.name,
    printableName: certificateName(updated) ?? "",
    certificateFinish: updated.certificateFinish,
    role: (await currentRole(req)) ?? updated.role,
  });
});

export default router;
