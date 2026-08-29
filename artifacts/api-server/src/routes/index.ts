import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import programsRouter from "./programs";
import sessionsRouter from "./sessions";
import enrollmentsRouter from "./enrollments";
import courseworkRouter from "./coursework";
import reviewsRouter from "./reviews";
import presenceRouter from "./presence";
import forumRouter from "./forum";
import adminRouter from "./admin";
import googleRecordingsRouter from "./googleRecordings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(programsRouter);
router.use(sessionsRouter);
router.use(enrollmentsRouter);
router.use(courseworkRouter);
router.use(reviewsRouter);
router.use(presenceRouter);
router.use(forumRouter);
router.use(adminRouter);
router.use(googleRecordingsRouter);

export default router;
