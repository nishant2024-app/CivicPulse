import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type ApiErrorBody,
  type ErrorCode,
} from "@civicpulse/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: NonNullable<ApiErrorBody["error"]["details"]> = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Message for a specific form field, if the server reported one. */
  fieldError(path: string): string | undefined {
    return this.details.find((detail) => detail.path === path)?.message;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
  if (body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "SERVICE_UNAVAILABLE", "Cannot reach the server. Check your connection.");
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const error = (payload as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? (response.status >= 500 ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST"),
      error?.message ??
        (response.status >= 500
          ? "The service is temporarily unavailable. Try again shortly."
          : "Request failed"),
      error?.details,
      error?.requestId,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
