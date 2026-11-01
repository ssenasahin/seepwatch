import {
  githubFileFetcher,
  parseEncryptionKey,
  type FetchGithubFile,
  type Mailer,
  type PrismaClient,
  type ResolveHost,
  type ResolveTxt,
  type Transport,
} from "@seepwatch/db";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { adminRouter } from "./admin/routes.js";
import { noProbe, type SystemProbe } from "./admin/system.js";
import { apiKeyRouter } from "./api-keys/routes.js";
import { requireAuth } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { channelRouter } from "./channels/routes.js";
import type { Env } from "./env.js";
import { escalationRouter } from "./escalation/routes.js";
import { findingRouter } from "./findings/routes.js";
import { healthRouter } from "./health.js";
import { incidentRouter, respondRouter } from "./incidents/routes.js";
import { errorHandler } from "./http.js";
import { rejectCrossSiteRequests } from "./origin.js";
import { teamRouter } from "./team/routes.js";
import { watchRouter } from "./watches/routes.js";

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  mailer: Mailer;
  // Overridable so the health check can be tested without a database.
  checkDatabase?: () => Promise<void>;
  // Overridable so the SSRF guard can be tested without real DNS.
  resolveHost?: ResolveHost;
  // Overridable so alert deliveries can be caught in tests.
  channelTransport?: Transport;
  // Overridable so domain and organization verification needs no real DNS or GitHub.
  resolveTxt?: ResolveTxt;
  fetchGithubFile?: FetchGithubFile;
  // Queue and Redis figures for the admin panel; without it they read as unknown.
  system?: SystemProbe;
}

// Building the app is separate from listening on a port, so tests can send
// requests to it directly and swap real dependencies for fakes.
export function createApp({
  env,
  prisma,
  mailer,
  checkDatabase,
  resolveHost,
  channelTransport,
  resolveTxt,
  fetchGithubFile = githubFileFetcher(env.GITHUB_TOKEN),
  system = noProbe,
}: AppDeps) {
  const app = express();
  const encryptionKey = parseEncryptionKey(env.ENCRYPTION_KEY);
  const authenticate = requireAuth(prisma, env.JWT_SECRET);

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(helmet());
  // Only our own web app may call the API from a browser, with credentials.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(rejectCrossSiteRequests(env.WEB_ORIGIN));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.use(
    "/api/health",
    healthRouter({
      checkDatabase:
        checkDatabase ??
        (async () => {
          await prisma.$queryRaw`SELECT 1`;
        }),
    }),
  );
  app.use("/api/auth", authRouter({ env, prisma, mailer, encryptionKey }));
  app.use(
    "/api/channels",
    channelRouter({
      prisma,
      authenticate,
      encryptionKey,
      webOrigin: env.WEB_ORIGIN,
      resolveHost,
      transport: channelTransport,
    }),
  );
  app.use("/api/watches", watchRouter({ prisma, authenticate, resolveTxt, fetchGithubFile }));
  app.use("/api/findings", findingRouter(prisma, authenticate));
  app.use("/api/incidents", incidentRouter(prisma, authenticate));
  // Public: an alert's signed link is the only proof needed.
  app.use("/api/respond", respondRouter(prisma, encryptionKey));
  app.use("/api/team", teamRouter({ prisma, mailer, authenticate, webOrigin: env.WEB_ORIGIN }));
  app.use("/api/escalation-policies", escalationRouter(prisma, authenticate));
  app.use("/api/api-keys", apiKeyRouter(prisma, authenticate));
  app.use(
    "/api/admin",
    adminRouter({
      prisma,
      jwtSecret: env.JWT_SECRET,
      mailer,
      webOrigin: env.WEB_ORIGIN,
      system,
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);

  return app;
}
