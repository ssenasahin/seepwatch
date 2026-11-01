import {
  dnsRecordName,
  GITHUB_FILE,
  GITHUB_REPO,
  KEY_LENGTH_MAX,
  KEY_LENGTH_MIN,
  keyPatternProblems,
  newVerifyToken,
  Prisma,
  verifyDomain,
  verifyGithubOrg,
  type FetchGithubFile,
  type PrismaClient,
  type ResolveTxt,
  type Watch,
} from "@seepwatch/db";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authOf } from "../auth/middleware.js";
import { HttpError, validate } from "../http.js";
import { assertRoomFor } from "../plans.js";
import { ownTeam } from "../team/routes.js";
import { coveringDomain, parseDomain, parseEmail, parseGithubOrg, type Parsed } from "./values.js";

const label = z.string().trim().max(100).nullable().optional();
const length = z.int().min(KEY_LENGTH_MIN).max(KEY_LENGTH_MAX);

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DOMAIN"), value: z.string().max(300), label }),
  z.object({ kind: z.literal("EMAIL"), value: z.string().max(320), label }),
  z.object({ kind: z.literal("GITHUB_ORG"), value: z.string().max(100), label }),
  z.object({
    kind: z.literal("KEY_PATTERN"),
    value: z.string().trim(),
    label,
    keyPattern: z.object({
      charset: z.enum(["ALNUM", "HEX", "BASE64URL"]),
      minLength: length,
      maxLength: length,
    }),
  }),
]);
const updateSchema = z.object({
  label,
  enabled: z.boolean().optional(),
  escalationPolicyId: z.uuid().nullable().optional(),
});
const idParams = z.object({ id: z.uuid() });

export interface WatchDeps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  // Overridable so verification can be tested without real DNS or GitHub.
  resolveTxt?: ResolveTxt;
  fetchGithubFile: FetchGithubFile;
}

const include = {
  escalationPolicy: { select: { id: true, name: true } },
  domainWatch: { select: { value: true, verifiedAt: true } },
} as const;
type Loaded = Watch & {
  escalationPolicy: { id: string; name: string } | null;
  domainWatch: { value: string; verifiedAt: Date | null } | null;
};

// How the owner proves a domain or organization is theirs, in the form the page shows.
function verification(w: Loaded) {
  const common = {
    verifiedAt: w.verifiedAt,
    lastVerifyAt: w.lastVerifyAt,
    lastVerifyError: w.lastVerifyError,
  };
  if (w.kind === "DOMAIN") {
    return {
      method: "dns" as const,
      record: { type: "TXT", name: dnsRecordName(w.value), value: w.verifyToken },
      ...common,
    };
  }
  if (w.kind === "GITHUB_ORG") {
    return {
      method: "github" as const,
      file: { repository: `${w.value}/${GITHUB_REPO}`, path: GITHUB_FILE, content: w.verifyToken },
      ...common,
    };
  }
  // An address is as verified as its domain; a key pattern needs no proof, because it
  // is only matched inside content that is already the owner's.
  if (w.kind === "EMAIL") {
    return {
      method: "domain" as const,
      domain: w.domainWatch?.value ?? null,
      ...common,
      verifiedAt: w.domainWatch?.verifiedAt ?? null,
    };
  }
  return { method: "none" as const };
}

function present(w: Loaded) {
  return {
    id: w.id,
    kind: w.kind,
    value: w.value,
    label: w.label,
    enabled: w.enabled,
    keyPattern:
      w.kind === "KEY_PATTERN"
        ? { charset: w.keyCharset, minLength: w.keyMinLength, maxLength: w.keyMaxLength }
        : null,
    verification: verification(w),
    escalationPolicy: w.escalationPolicy,
    createdAt: w.createdAt,
  };
}

function valueError(problem: string) {
  return new HttpError(400, "Invalid request", { value: [problem] });
}

function unwrap(parsed: Parsed): string {
  if ("problem" in parsed) throw valueError(parsed.problem);
  return parsed.value;
}

const isDuplicate = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export function watchRouter({ prisma, authenticate, resolveTxt, fetchGithubFile }: WatchDeps) {
  const router = Router();
  router.use(authenticate);

  // Each attempt is a DNS lookup or a GitHub request on the server's behalf.
  const verifyLimit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => authOf(req).userId,
    message: { error: "That's a lot of checks. Wait a minute and try again." },
  });

  async function findOwned(id: string, ownerId: string) {
    const watch = await prisma.watch.findFirst({ where: { id, ownerId }, include });
    if (!watch) throw new HttpError(404, "Watch not found");
    return watch;
  }

  // The data a new watch is stored with, past every check that needs no database.
  async function build(ownerId: string, input: z.infer<typeof createSchema>) {
    switch (input.kind) {
      case "DOMAIN":
        return { value: unwrap(parseDomain(input.value)), verifyToken: newVerifyToken() };
      case "GITHUB_ORG":
        return { value: unwrap(parseGithubOrg(input.value)), verifyToken: newVerifyToken() };
      case "EMAIL": {
        const parsed = parseEmail(input.value);
        if ("problem" in parsed) throw valueError(parsed.problem);
        const domains = await prisma.watch.findMany({
          where: { ownerId, kind: "DOMAIN" },
          select: { id: true, value: true, verifiedAt: true },
        });
        const verified = domains.filter((d) => d.verifiedAt).map((d) => d.value);
        const parent = coveringDomain(parsed.domain!, verified);
        if (!parent) {
          const pending = coveringDomain(
            parsed.domain!,
            domains.map((d) => d.value),
          );
          throw valueError(
            pending
              ? `Verify ${pending} first; addresses are watched once their domain is proven yours`
              : `Add and verify ${parsed.domain} as a domain first`,
          );
        }
        return {
          value: parsed.value,
          domainWatchId: domains.find((d) => d.value === parent)!.id,
        };
      }
      case "KEY_PATTERN": {
        const pattern = { prefix: input.value, ...input.keyPattern };
        const problems = keyPatternProblems(pattern);
        if (problems) {
          const { prefix, ...rest } = problems;
          throw new HttpError(400, "Invalid request", {
            ...(prefix && { value: [prefix] }),
            ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [`keyPattern.${k}`, [v]])),
          });
        }
        // Prefixes are case-sensitive in keys, so this one is stored as typed.
        return {
          value: pattern.prefix,
          keyCharset: pattern.charset,
          keyMinLength: pattern.minLength,
          keyMaxLength: pattern.maxLength,
        };
      }
    }
  }

  router.get("/", async (req, res) => {
    const { userId } = authOf(req);
    const watches = await prisma.watch.findMany({
      where: { ownerId: userId },
      orderBy: [{ kind: "asc" }, { value: "asc" }],
      include,
    });
    res.json({ watches: watches.map(present) });
  });

  router.post("/", async (req, res) => {
    const { userId } = authOf(req);
    const input = validate(createSchema, req.body);
    await assertRoomFor(prisma, userId, "watches");
    const data = await build(userId, input);
    try {
      const watch = await prisma.watch.create({
        data: { ownerId: userId, kind: input.kind, label: input.label || null, ...data },
        include,
      });
      res.status(201).json({ watch: present(watch) });
    } catch (err) {
      if (isDuplicate(err)) throw valueError("You're already watching this");
      throw err;
    }
  });

  router.patch("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const input = validate(updateSchema, req.body);
    await findOwned(id, userId);
    if (input.escalationPolicyId) {
      const team = await ownTeam(prisma, userId);
      const policy = await prisma.escalationPolicy.findFirst({
        where: { id: input.escalationPolicyId, teamId: team.id },
      });
      if (!policy) {
        throw new HttpError(400, "Invalid request", {
          escalationPolicyId: ["Pick one of your own escalation policies"],
        });
      }
    }
    const watch = await prisma.watch.update({
      where: { id },
      data: {
        label: input.label === undefined ? undefined : input.label || null,
        enabled: input.enabled,
        escalationPolicyId: input.escalationPolicyId,
      },
      include,
    });
    res.json({ watch: present(watch) });
  });

  // A domain takes its addresses with it.
  router.delete("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const { count } = await prisma.watch.deleteMany({ where: { id, ownerId: userId } });
    if (count === 0) throw new HttpError(404, "Watch not found");
    res.status(204).end();
  });

  // Looks for the token now. A success stays until the watch is deleted; the scanners
  // will check again from time to time and pause a watch whose proof has gone.
  router.post("/:id/verify", verifyLimit, async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const watch = await findOwned(id, userId);
    if (!watch.verifyToken) {
      throw new HttpError(400, "This kind of watch doesn't need verifying");
    }
    const result =
      watch.kind === "DOMAIN"
        ? await verifyDomain(watch.value, watch.verifyToken, resolveTxt)
        : await verifyGithubOrg(watch.value, watch.verifyToken, fetchGithubFile);
    const now = new Date();
    const updated = await prisma.watch.update({
      where: { id },
      data: result.ok
        ? { verifiedAt: watch.verifiedAt ?? now, lastVerifyAt: now, lastVerifyError: null }
        : { lastVerifyAt: now, lastVerifyError: result.reason },
      include,
    });
    res.json({ verified: result.ok, watch: present(updated) });
  });

  return router;
}
