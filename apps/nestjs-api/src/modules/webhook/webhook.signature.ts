import { createHmac } from "node:crypto";

/** HMAC-SHA256 hex signature over the request body — matches Django's X-Plane-Signature. */
export function signWebhook(secretKey: string, body: string): string {
  return createHmac("sha256", secretKey).update(body, "utf-8").digest("hex");
}
