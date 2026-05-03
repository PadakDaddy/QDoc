import type { IncomingMessage, ServerResponse } from "node:http";

const maxJsonBytes = 1024 * 16;

export async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > maxJsonBytes) {
      throw new Error("request_body_too_large");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export function parseCookies(request: IncomingMessage) {
  const cookieHeader = request.headers.cookie;
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (!rawName) {
      continue;
    }

    try {
      cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
    } catch {
      continue;
    }
  }

  return cookies;
}
