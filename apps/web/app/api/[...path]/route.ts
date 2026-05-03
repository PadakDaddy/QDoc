import { NextResponse, type NextRequest } from "next/server";

function getApiBaseUrl() {
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("API_BASE_URL is required in production");
  }

  return "http://127.0.0.1:4000";
}

function getTargetUrl(request: NextRequest, path: string[]) {
  const url = new URL(request.url);
  const target = new URL(path.join("/"), `${getApiBaseUrl()}/`);
  target.search = url.search;
  return target;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = getTargetUrl(request, path);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  const setCookie = upstream.headers.get("set-cookie");

  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }

  if (setCookie) {
    responseHeaders.set("set-cookie", setCookie);
  }

  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}
