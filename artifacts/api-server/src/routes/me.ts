import { Router, type IRouter } from "express";
import { getCurrentUser } from "../lib/auth";

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
    role: user.role,
  });
});

export default router;
