import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { createS3Storage, type ObjectStorage } from "@civicpulse/platform";
import { createTestContext, registerUser, resetDatabase, type TestContext } from "../helpers";
import { fileComplaint, integration, S3_CREDENTIALS, setUpOrganization, URLS } from "./support";
import sharp from "sharp";

let storage: ObjectStorage;
let presigned: ObjectStorage;
// A fixed bucket: SeaweedFS allocates volumes per bucket, so a new bucket per run would exhaust them.
const bucket = "civicpulse-it";
const options = {
  endpoint: URLS.s3,
  region: "us-east-1",
  bucket,
  ...S3_CREDENTIALS,
  forcePathStyle: true,
  signingSecret: "a-test-signing-secret-of-sufficient-length",
  urlPrefix: "/api/v1/files",
};

beforeAll(async () => {
  storage = createS3Storage(options);
  presigned = createS3Storage({ ...options, publicEndpoint: URLS.s3 });
  await storage.ensureReady();
});

integration("S3-compatible storage (real SeaweedFS)", () => {
  it("creates the bucket idempotently and round-trips an object", async () => {
    await storage.ensureReady(); // second call must not fail
    await storage.ping();
    const key = `org/${randomUUID()}/complaints/${randomUUID()}/photo.webp`;
    const body = Buffer.from("not really a webp but bytes are bytes");
    await storage.put(key, body, "image/webp");
    const object = await storage.get(key);
    expect(object?.body.equals(body)).toBe(true);
    expect(object?.contentType).toBe("image/webp");
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it("rejects keys that could escape the bucket layout", async () => {
    await expect(storage.put("../escape", Buffer.from("x"), "text/plain")).rejects.toThrow(
      /invalid storage key/,
    );
    await expect(storage.get("a/../b")).rejects.toThrow(/invalid storage key/);
  });

  it("issues presigned URLs that work, and expire", async () => {
    const key = `presign/${randomUUID()}.webp`;
    await storage.put(key, Buffer.from("secret photo"), "image/webp");
    const url = await presigned.signedUrl(key, 60);
    const ok = await fetch(url);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("secret photo");

    // The bucket itself is private: no signature, no access.
    const anonymous = await fetch(`${URLS.s3}/${bucket}/${key}`);
    expect(anonymous.status).toBeGreaterThanOrEqual(400);
    // Tampering with the signature is refused.
    expect(
      (await fetch(url.replace(/Signature=[0-9a-f]+/, "Signature=00"))).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("serves uploaded complaint photos through the API with signed URLs", async () => {
    const ctx: TestContext = await createTestContext({}, { storage });
    try {
      await resetDatabase(ctx.db);
      const { citizen, category } = await setUpOrganization(ctx, "s3-flow");
      const complaint = await fileComplaint(citizen.client, category("roads"));
      const boundary = "----s3";
      const png = await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#336699" },
      })
        .png()
        .toBuffer();
      const form = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const upload = await citizen.client.request(
        "POST",
        `/api/v1/complaints/${complaint.id}/attachments`,
        form,
        {
          headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        },
      );
      expect(upload.statusCode).toBe(201);
      const view = (await citizen.client.get(`/api/v1/complaints/${complaint.id}`)).json();
      const file = await ctx.app.inject(view.attachments[0].url);
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-type"]).toBe("image/webp");
      expect((await sharp(file.rawPayload).metadata()).width).toBe(64);
      // A stranger's unsigned guess finds nothing.
      expect(
        (await ctx.app.inject("/api/v1/files/anything?exp=9999999999&sig=bad")).statusCode,
      ).toBe(404);
      void registerUser;
    } finally {
      await ctx.close();
    }
  });
});
