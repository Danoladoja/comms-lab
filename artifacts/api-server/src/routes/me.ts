import { Router, type IRouter } from "express";
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
    // The effective role, not the stored one. A super admin was being sent
    // their database row, and every gate in the browser compares against
    // "admin" — so an appointed super admin was locked out of the console they
    // had just been given. The founder, whose row says admin, has the same
    // problem in reverse.
    role: (await currentRole(req)) ?? user.role,
  });
});

export default router;
