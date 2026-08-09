import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import programsRouter from "./programs";
import sessionsRouter from "./sessions";
import enrollmentsRouter from "./enrollments";
import courseworkRouter from "./coursework";
import forumRouter from "./forum";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(programsRouter);
router.use(sessionsRouter);
router.use(enrollmentsRouter);
router.use(courseworkRouter);
router.use(forumRouter);
router.use(adminRouter);

export default router;
