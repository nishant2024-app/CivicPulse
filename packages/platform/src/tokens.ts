import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Cryptographically random URL-safe token (default 256 bits). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * SHA-256 digest used to store bearer secrets (sessions, reset tokens, invitations).
 * These are high-entropy random values, so a fast hash is appropriate — unlike passwords.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Crockford base32 without I, L, O, U: unambiguous when read aloud or typed.
const TRACKING_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Public complaint tracking ID: `CP-` + 10 random characters (50 bits). */
export function generateTrackingId(): string {
  let id = "";
  for (let i = 0; i < 10; i++) id += TRACKING_ALPHABET[randomInt(TRACKING_ALPHABET.length)];
  return `CP-${id}`;
}

export const TRACKING_ID_PATTERN = /^CP-[0-9A-HJKMNP-TV-Z]{10}$/;
