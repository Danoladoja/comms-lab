import { Router, type IRouter } from "express";
import {
  enquiryHtml,
  enquirySubject,
  validateEnquiry,
} from "@workspace/domain";
import { EmailRejectedError, emailConfigured, sendEmail } from "../lib/email";
import { createBudget } from "../lib/rateBudget";
import { logger } from "../lib/logger";

/**
 * The partnerships form.
 *
 * The only endpoint on this server that writes anything without a signed-in
 * user behind it, which makes it the one an abusive script will find first.
 * Three things guard it: a hidden field the crude scrapers fill and people
 * never see, a small per-address budget, and validation that refuses anything
 * unusable before a mail provider is ever contacted.
 *
 * The enquiry is delivered by email and stored nowhere. That was a deliberate
 * choice, and it sets the standard this route has to meet: if the send fails,
 * the enquiry is gone. So a failure is never reported as success — the caller
 * is told plainly, and the page shows a direct address to fall back on.
 */

const router: IRouter = Router();

/** Where enquiries land. Overridable so it can be changed without a deploy. */
function recipient(): { email: string; name: string } {
  return {
    email: process.env.PARTNERSHIP_EMAIL || "africaenergypulse@gmail.com",
    name: "Ananse Comms Lab",
  };
}

/** See lib/rateBudget: this and the waitlist share one implementation. */
export const partnershipBudget = createBudget({ windowMs: 60 * 60 * 1000, max: 5 });

router.post("/partnership-enquiries", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const result = validateEnquiry({
    name: typeof body.name === "string" ? body.name : undefined,
    organisation: typeof body.organisation === "string" ? body.organisation : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
    interest: typeof body.interest === "string" ? body.interest : undefined,
    message: typeof body.message === "string" ? body.message : undefined,
    honeypot: typeof body.honeypot === "string" ? body.honeypot : undefined,
  });

  // A bot filled the hidden field. Answer exactly as we answer a real person:
  // an error here would tell whoever is probing which field gave them away.
  if (result.spam) {
    logger.info({ ip: req.ip }, "Dropped a partnership enquiry that tripped the honeypot");
    res.status(202).json({ message: "Thank you. We will be in touch." });
    return;
  }

  if (result.problems) {
    res.status(400).json(result.problems);
    return;
  }

  // Checked after validation on purpose: a malformed submission should get its
  // list of problems back rather than being spent against the budget.
  if (partnershipBudget.overBudget(req.ip ?? "unknown")) {
    logger.warn({ ip: req.ip }, "Partnership enquiries over budget for this address");
    res.status(429).json({
      message: "That is several enquiries in a short time. Please try again later, or email us directly.",
    });
    return;
  }

  const enquiry = result.enquiry;

  // Said out loud rather than swallowed. Without a key the message would vanish
  // and the sender would be thanked for it, which is the worst of both.
  if (!emailConfigured()) {
    logger.error(
      { organisation: enquiry.organisation },
      "A partnership enquiry arrived but BREVO_API_KEY is not set, so it could not be delivered",
    );
    res.status(503).json({
      message: "Our contact form is not available right now. Please email us directly.",
    });
    return;
  }

  try {
    await sendEmail({
      to: recipient(),
      subject: enquirySubject(enquiry),
      html: enquiryHtml(enquiry, new Date()),
    });
  } catch (err) {
    // The full enquiry goes to the log. It is the only remaining copy, and a
    // partner who took the trouble to write deserves better than silence.
    logger.error(
      { err, enquiry },
      "Could not deliver a partnership enquiry; the text is recorded here",
    );

    const definite = err instanceof EmailRejectedError;
    res.status(503).json({
      message: definite
        ? "We could not send that just now. Please email us directly."
        : "That may not have gone through. Please email us directly to be sure.",
    });
    return;
  }

  logger.info(
    { organisation: enquiry.organisation, interest: enquiry.interest },
    "Partnership enquiry delivered",
  );
  res.status(202).json({ message: "Thank you. We will be in touch." });
});

export default router;
