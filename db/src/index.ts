import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

// Besides the Prisma client, this package holds the code the API and the worker share.
export * from "./generated/prisma/client.js";
export { decryptSecret, encryptSecret, parseEncryptionKey } from "./crypto.js";
export { deliver, openConfig, sealConfig, type DeliverOptions } from "./channels/deliver.js";
export { guardedTransport } from "./channels/transport.js";
export {
  DeliveryError,
  SECRET_FIELDS,
  type AlertMessage,
  type ChannelConfig,
  type ConfigOf,
  type Transport,
} from "./channels/types.js";
export { SIGNATURE_HEADER, signWebhook, TIMESTAMP_HEADER } from "./channels/webhook.js";
export {
  emailLayout,
  escapeHtml,
  smtpMailer,
  type Mail,
  type Mailer,
  type SmtpConfig,
} from "./mailer.js";
export {
  guardedLookup,
  isPublicAddress,
  resolveHost,
  resolvePublicHost,
  UnsafeTargetError,
  USER_AGENT,
  type Resolve,
  type ResolveHost,
} from "./network.js";
export {
  MAX_ESCALATION_STEPS,
  readSteps,
  respondLink,
  signRespond,
  verifyRespond,
  type EscalationStep,
  type EscalationTarget,
} from "./escalation.js";
export {
  ACK_REMINDER_MS,
  CLOSED,
  isClosed,
  needsReason,
  nextStatus,
  OPEN_REMINDER_MS,
  planRound,
  type Action,
  type Audience,
  type Round,
  type RoundKind,
} from "./incidents.js";
export { ALERTS_QUEUE, FEEDS_QUEUE, redisConnection, SCANS_QUEUE, type ScanJob } from "./queues.js";
export {
  detect,
  DETECTORS,
  detectorLabel,
  fingerprint,
  fingerprintKey,
  KEY_PATTERN_DETECTOR,
  mask,
  redactedContext,
  type Detector,
  type Hit,
} from "./detectors.js";
export {
  KEY_LENGTH_MAX,
  KEY_LENGTH_MIN,
  KEY_PREFIX_MAX,
  KEY_PREFIX_MIN,
  keyPatternProblems,
  keyPatternRegExp,
  keyPatternSource,
  type KeyPattern,
} from "./watches.js";
export {
  dnsRecordName,
  GITHUB_FILE,
  GITHUB_REPO,
  githubFileFetcher,
  newVerifyToken,
  resolveTxt,
  verifyDomain,
  verifyGithubOrg,
  type FetchGithubFile,
  type ResolveTxt,
  type VerifyResult,
} from "./verification.js";

// Each client holds its own pool of connections through node-postgres. Prisma 6
// gave up on a connection after 5 seconds; pg would wait forever, so keep that limit.
export function createPrisma(connectionString = process.env.DATABASE_URL) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 }),
  });
}

// One client per process.
export const prisma = createPrisma();
