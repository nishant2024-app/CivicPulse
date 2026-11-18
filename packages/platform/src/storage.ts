import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
  signedUrl(key: string, ttlSeconds?: number): string | Promise<string>;
  /** Validate a request to the API's file route and return the key it grants, or null. */
  verifySignedRequest?(encodedKey: string, expires: string, signature: string): string | null;
  /** Create the bucket or directory if needed; safe to call on every start. */
  ensureReady(): Promise<void>;
  ping(): Promise<void>;
}

const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,500}$/;

function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("invalid storage key");
}

/** HMAC-signed, expiring URLs served by the API. Used when the store itself is not public. */
function createUrlSigner(secret: string, urlPrefix: string) {
  const key32 = createHmac("sha256", secret).update("storage-urls-v1").digest();
  const sign = (key: string, expires: number) =>
    createHmac("sha256", key32).update(`${key}\n${expires}`).digest("base64url");
  return {
    url(key: string, ttlSeconds: number): string {
      assertSafeKey(key);
      const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
      return `${urlPrefix}/${Buffer.from(key).toString("base64url")}?exp=${expires}&sig=${sign(key, expires)}`;
    },
    verify(encodedKey: string, expires: string, signature: string): string | null {
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

/** Disk-backed storage for development and single-node deployments. */
export function createLocalStorage(options: {
  directory: string;
  signingSecret: string;
  urlPrefix: string;
}): ObjectStorage {
  const root = path.resolve(options.directory);
  const signer = createUrlSigner(options.signingSecret, options.urlPrefix);
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
    signedUrl: (key, ttlSeconds = 600) => signer.url(key, ttlSeconds),
    verifySignedRequest: signer.verify,
    async ensureReady() {
      await mkdir(root, { recursive: true });
    },
    async ping() {
      await mkdir(root, { recursive: true });
    },
  };
}

export interface S3Options {
  endpoint?: string;
  /** If set, URLs are presigned against this endpoint and browsers download directly. */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  signingSecret: string;
  urlPrefix: string;
}

/**
 * Any S3-compatible store: AWS S3, Cloudflare R2, SeaweedFS, Garage. Buckets stay private.
 * Without `publicEndpoint`, downloads are served by the API through HMAC-signed URLs, so
 * the store never needs to be reachable from the internet.
 */
export function createS3Storage(options: S3Options): ObjectStorage {
  const credentials = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
  };
  const make = (endpoint?: string) =>
    new S3Client({
      region: options.region,
      credentials,
      forcePathStyle: options.forcePathStyle,
      ...(endpoint ? { endpoint } : {}),
    });
  const client = make(options.endpoint);
  const presigner = options.publicEndpoint ? make(options.publicEndpoint) : null;
  const signer = createUrlSigner(options.signingSecret, options.urlPrefix);
  const Bucket = options.bucket;

  return {
    driver: "s3",
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      assertSafeKey(key);
      try {
        const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        const body = Buffer.from(await response.Body!.transformToByteArray());
        return { body, contentType: response.ContentType ?? "application/octet-stream" };
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === "NoSuchKey" || name === "NotFound") return null;
        throw error;
      }
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    signedUrl(key, ttlSeconds = 600) {
      assertSafeKey(key);
      if (presigner) {
        return getSignedUrl(presigner, new GetObjectCommand({ Bucket, Key: key }), {
          expiresIn: ttlSeconds,
        });
      }
      return signer.url(key, ttlSeconds);
    },
    verifySignedRequest: signer.verify,
    async ensureReady() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch {
        try {
          await client.send(new CreateBucketCommand({ Bucket }));
        } catch (error) {
          const name = (error as { name?: string }).name;
          if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
        }
      }
    },
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket }));
    },
  };
}
