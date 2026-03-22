import { NextRequest } from "next/server";
import { getServerBackendBase } from "@/lib/serverBackendBase";

export const dynamic = "force-dynamic";

const REQUEST_HEADER_BLOCKLIST = new Set([
  "host",
  "connection",
  "content-length"
]);

async function proxy(request: NextRequest, params: { path?: string[] }) {
  const base = getServerBackendBase();
  const incomingUrl = new URL(request.url);
  const pathname = params.path?.join("/") ?? "";
  const target = new URL(`${base}/${pathname}`);
  target.search = incomingUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  const upstream = await fetch(target, {
    method,
    headers,
    body,
    cache: "no-store",
    redirect: "manual"
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") {
      responseHeaders.append(key, value);
    }
  });

  const setCookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }

  const responseBody =
    method === "HEAD"
      ? null
      : await upstream.arrayBuffer();

  return new Response(responseBody, {
    status: upstream.status,
    headers: responseHeaders
  });
}

type RouteContext = {
  params: {
    path?: string[];
  };
};

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}
