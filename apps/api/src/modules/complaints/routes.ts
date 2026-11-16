import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  assignComplaintSchema,
  changeStatusSchema,
  complaintDetailSchema,
  complaintListQuerySchema,
  complaintSummarySchema,
  createCommentSchema,
  createComplaintSchema,
  feedbackSchema,
  paginated,
  updateComplaintSchema,
  uuidSchema,
} from "@civicpulse/shared";
import { AppError, errors } from "../../errors";
import { paginate, requestMeta } from "../../http";
import { processImage } from "./images";
import * as service from "./service";

const idParams = z.object({ id: uuidSchema });
const ok = z.object({ ok: z.literal(true) });
const tags = ["Complaints"];

export const complaintRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.authenticate);
  const detail = (request: Parameters<typeof requestMeta>[0], id: string) =>
    service.getComplaint(app.db, app.storage, request.tenant(), id);

  app.post(
    "/",
    {
      preHandler: app.requirePermission("complaint:create"),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Report an issue",
        body: createComplaintSchema,
        response: { 201: complaintDetailSchema },
      },
    },
    async (request, reply) => {
      const created = await service.createComplaint(
        app.db,
        request.tenant(),
        request.body,
        requestMeta(request),
      );
      return reply.status(201).send(await detail(request, created.id));
    },
  );

  app.get(
    "/",
    {
      schema: {
        tags,
        summary: "List complaints visible to the caller",
        description:
          "Citizens see their own reports, field workers their assignments, department " +
          "managers their department, administrators everything in the organization.",
        querystring: complaintListQuerySchema,
        response: { 200: paginated(complaintSummarySchema) },
      },
    },
    async (request) => {
      const { total, rows } = await service.listComplaints(app.db, request.tenant(), request.query);
      return {
        data: rows,
        pagination: paginate(request.query.page, request.query.pageSize, total),
      };
    },
  );

  app.get(
    "/:id",
    {
      schema: {
        tags,
        summary: "Complaint detail",
        params: idParams,
        response: { 200: complaintDetailSchema },
      },
    },
    async (request) => detail(request, request.params.id),
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("complaint:triage"),
      schema: {
        tags,
        summary: "Change priority or category",
        params: idParams,
        body: updateComplaintSchema,
        response: { 200: complaintDetailSchema },
      },
    },
    async (request) => {
      await service.updateTriage(
        app.db,
        request.tenant(),
        request.params.id,
        request.body,
        requestMeta(request),
      );
      return detail(request, request.params.id);
    },
  );

  app.post(
    "/:id/status",
    {
      schema: {
        tags,
        summary: "Move the complaint to another status",
        description: "Allowed moves depend on the current status and on who is asking.",
        params: idParams,
        body: changeStatusSchema,
        response: { 200: complaintDetailSchema },
      },
    },
    async (request) => {
      await service.changeStatus(
        app.db,
        request.tenant(),
        request.params.id,
        request.body,
        requestMeta(request),
      );
      return detail(request, request.params.id);
    },
  );

  app.post(
    "/:id/assign",
    {
      preHandler: app.requirePermission("complaint:triage"),
      schema: {
        tags,
        summary: "Assign to a department and, optionally, a field worker",
        params: idParams,
        body: assignComplaintSchema,
        response: { 200: complaintDetailSchema },
      },
    },
    async (request) => {
      await service.assignComplaint(
        app.db,
        request.tenant(),
        request.params.id,
        request.body,
        requestMeta(request),
      );
      return detail(request, request.params.id);
    },
  );

  app.post(
    "/:id/assignment/accept",
    {
      preHandler: app.requirePermission("complaint:work"),
      schema: {
        tags,
        summary: "Accept the pending assignment",
        params: idParams,
        response: { 200: complaintDetailSchema },
      },
    },
    async (request) => {
      await service.acceptAssignment(app.db, request.tenant(), request.params.id);
      return detail(request, request.params.id);
    },
  );

  app.post(
    "/:id/comments",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Reply, or add an internal note (staff)",
        params: idParams,
        body: createCommentSchema,
        response: { 201: complaintDetailSchema },
      },
    },
    async (request, reply) => {
      await service.addComment(
        app.db,
        request.tenant(),
        request.params.id,
        request.body,
        requestMeta(request),
      );
      return reply.status(201).send(await detail(request, request.params.id));
    },
  );

  app.post(
    "/:id/feedback",
    {
      schema: {
        tags,
        summary: "Rate the resolution (reporter, once)",
        params: idParams,
        body: feedbackSchema,
        response: { 201: ok },
      },
    },
    async (request, reply) => {
      await service.submitFeedback(app.db, request.tenant(), request.params.id, request.body);
      return reply.status(201).send({ ok: true as const });
    },
  );

  app.post(
    "/:id/attachments",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Upload a photo (multipart field `file`; JPEG, PNG or WebP)",
        consumes: ["multipart/form-data"],
        params: idParams,
        response: { 201: z.object({ id: uuidSchema }) },
      },
    },
    async (request, reply) => {
      const ctx = request.tenant();
      if (!request.isMultipart()) throw errors.badRequest("Send the photo as multipart/form-data");
      const file = await request.file();
      if (!file) throw errors.badRequest("No file was uploaded");
      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        throw new AppError(
          "PAYLOAD_TOO_LARGE",
          `Photos can be up to ${Math.floor(app.config.UPLOAD_MAX_BYTES / 1_048_576)} MB`,
        );
      }
      const image = await processImage(buffer);
      const created = await service.addAttachment(
        app.db,
        app.storage,
        ctx,
        request.params.id,
        image,
        requestMeta(request),
      );
      return reply.status(201).send(created);
    },
  );
};
