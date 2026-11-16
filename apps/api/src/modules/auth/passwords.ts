import { hash, verify } from "@node-rs/argon2";

// OWASP baseline for Argon2id: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS = {
  // Algorithm.Argon2id — the enum is a const enum and cannot be imported under verbatimModuleSyntax.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed hash in the database: treat as a failed verification, never as success.
    return false;
  }
}

/** True when the stored hash was produced with weaker parameters than the current ones. */
export function needsRehash(passwordHash: string): boolean {
  const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
  if (!match) return true;
  return (
    Number(match[1]) < OPTIONS.memoryCost ||
    Number(match[2]) < OPTIONS.timeCost ||
    Number(match[3]) < OPTIONS.parallelism
  );
}

let dummyHash: Promise<string> | undefined;

/**
 * Spend the same time as a real verification when the account does not exist,
 * so response time does not reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("civicpulse-dummy-password");
  await verifyPassword(await dummyHash, password);
}
