import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export type Role = "receptionist" | "manager";
export type SessionUser = { id: string; name: string; email: string; role: Role };
type SessionPayload = SessionUser & { iat: number; exp: number };

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || "atelier_session";

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters.");
  return secret;
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signature(value: string) {
  return createHmac("sha256", jwtSecret()).update(value).digest("base64url");
}

export function signSession(user: SessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(process.env.JWT_EXPIRES_IN_SECONDS || 60 * 60 * 8);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encode(JSON.stringify({ ...user, iat: now, exp: now + ttl } satisfies SessionPayload));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = signature(unsigned);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.id || !payload.email || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionFromRequest(request: NextRequest) {
  return verifySessionToken(request.cookies.get(COOKIE_NAME)?.value);
}

export function sessionCookieName() {
  return COOKIE_NAME;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Number(process.env.JWT_EXPIRES_IN_SECONDS || 60 * 60 * 8),
  };
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
