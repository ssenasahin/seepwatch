import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ISSUER = "seepwatch";
const AUDIENCE = "seepwatch-web";

export interface AccessClaims {
  userId: string;
  sessionId: string;
  role: "USER" | "SUPER_ADMIN";
  // Whether this session passed a second factor.
  mfa: boolean;
}

export async function signAccessToken(claims: AccessClaims, secret: string): Promise<string> {
  return new SignJWT({ sid: claims.sessionId, role: claims.role, mfa: claims.mfa })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));
}

// Throws if the signature, issuer, audience or expiry is wrong.
export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    throw new Error("Access token is missing claims");
  }
  return {
    userId: payload.sub,
    sessionId: payload.sid,
    role: payload.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER",
    mfa: payload.mfa === true,
  };
}

// Issued after a correct password when two-factor is on. It proves only that the
// first step passed, for five minutes, and is accepted by nothing but the second step.
const CHALLENGE_AUDIENCE = "seepwatch-2fa";

export async function signChallengeToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(CHALLENGE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}

export async function verifyChallengeToken(token: string, secret: string): Promise<string> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: ISSUER,
    audience: CHALLENGE_AUDIENCE,
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string") throw new Error("Challenge token is missing its subject");
  return payload.sub;
}

// A refresh token is "<session id>.<secret>". The id finds the session row; only
// a hash of the secret is stored, so a database leak yields no usable tokens.
export function newRefreshSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: sha256(secret) };
}

export function formatRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(token: unknown): { sessionId: string; secret: string } | null {
  if (typeof token !== "string") return null;
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  return { sessionId: match[1]!, secret: match[2]! };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Compares in constant time, so the response time leaks nothing about how many
// leading characters of a guess were right.
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
