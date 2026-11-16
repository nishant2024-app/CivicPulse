import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeEqual } from "./tokens";

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface ObjectStorage {
  readonly driver: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** A time-limited URL that grants read access to exactly this object. */
  signedUrl(key: string, ttlSeconds?: number): string;
  /** Local driver only: validate a signed request and return the key it grants. */
  verifySignedRequest?(encodedKey: string, expires: string, signature: string): string | null;
}

const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,500}$/;

function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("invalid storage key");
}

/**
 * Disk-backed storage for development and single-node deployments.
 * Objects are private; reads go through HMAC-signed URLs served by the API.
 */
export function createLocalStorage(options: {
  directory: string;
  signingSecret: string;
  urlPrefix: string;
}): ObjectStorage {
  const root = path.resolve(options.directory);
  const key32 = createHmac("sha256", options.signingSecret).update("storage-urls-v1").digest();
  const sign = (key: string, expires: number) =>
    createHmac("sha256", key32).update(`${key}\n${expires}`).digest("base64url");
  const locate = (key: string) => {
    assertSafeKey(key);
    return { file: path.join(root, key), meta: path.join(root, `${key}.meta`) };
  };

  return {
    driver: "local",
    async put(key, body, contentType) {
      const { file, meta } = locate(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(meta, contentType);
    },
    async get(key) {
      const { file, meta } = locate(key);
      try {
        const [body, contentType] = await Promise.all([readFile(file), readFile(meta, "utf8")]);
        return { body, contentType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      const { file, meta } = locate(key);
      await Promise.all([rm(file, { force: true }), rm(meta, { force: true })]);
    },
    signedUrl(key, ttlSeconds = 600) {
      assertSafeKey(key);
      const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
      const encoded = Buffer.from(key).toString("base64url");
      return `${options.urlPrefix}/${encoded}?exp=${expires}&sig=${sign(key, expires)}`;
    },
    verifySignedRequest(encodedKey, expires, signature) {
      const expiresAt = Number(expires);
      if (!Number.isInteger(expiresAt) || expiresAt < Date.now() / 1000) return null;
      let key: string;
      try {
        key = Buffer.from(encodedKey, "base64url").toString("utf8");
        assertSafeKey(key);
      } catch {
        return null;
      }
      return safeEqual(sign(key, expiresAt), signature) ? key : null;
    },
  };
}
