import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import programsRouter from "./programs";
import sessionsRouter from "./sessions";
import enrollmentsRouter from "./enrollments";
import courseworkRouter from "./coursework";
import reviewsRouter from "./reviews";
import presenceRouter from "./presence";
import slidesRouter from "./slides";
import forumRouter from "./forum";
import adminRouter from "./admin";
import googleRecordingsRouter from "./googleRecordings";
import partnershipsRouter from "./partnerships";
import programThumbnailsRouter from "./programThumbnails";
import bulkInvitesRouter from "./bulkInvites";
import waitlistRouter from "./waitlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(programThumbnailsRouter);
router.use(bulkInvitesRouter);
router.use(waitlistRouter);
router.use(programsRouter);
router.use(sessionsRouter);
router.use(enrollmentsRouter);
router.use(courseworkRouter);
router.use(reviewsRouter);
router.use(presenceRouter);
router.use(slidesRouter);
router.use(forumRouter);
router.use(adminRouter);
router.use(googleRecordingsRouter);
router.use(partnershipsRouter);

export default router;
