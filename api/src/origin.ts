import type { RequestHandler } from "express";
import { HttpError } from "./http.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF protection for state-changing requests. Browsers attach Origin and
// Sec-Fetch-Site to every such request and pages cannot forge them, so a form or
// script on another site that tries to POST here is recognised and refused.
// Requests without these headers come from servers and scripts (curl, cron
// pings, API clients) which hold no browser cookies to abuse, so they pass.
export function rejectCrossSiteRequests(webOrigin: string): RequestHandler {
  const allowed = new URL(webOrigin).origin;
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get("origin");
    const site = req.get("sec-fetch-site");
    if (site === "cross-site" || (origin !== undefined && origin !== allowed)) {
      throw new HttpError(403, "Cross-site request refused");
    }
    next();
  };
}
