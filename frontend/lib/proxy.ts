import { NextRequest, NextResponse } from "next/server";

export const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://127.0.0.1:8000";

/**
 * Forwards an incoming Next.js Request to the backend FastAPI server.
 * Handles headers, query parameters, multipart/binary bodies, and streaming responses.
 */
export async function proxyToBackend(
  req: NextRequest,
  backendPath: string,
): Promise<Response> {
  const targetUrl = new URL(backendPath, BACKEND_URL);

  // Preserve query parameters
  req.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    // Do not forward host or hop-by-hop headers
    if (
      lowerKey !== "host" &&
      lowerKey !== "connection" &&
      lowerKey !== "content-length" &&
      lowerKey !== "keep-alive"
    ) {
      headers.set(key, value);
    }
  });

  const method = req.method;
  let body: ArrayBuffer | undefined = undefined;

  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await req.arrayBuffer();
    } catch {
      body = undefined;
    }
  }

  try {
    const backendRes = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
    });

    const responseHeaders = new Headers();
    backendRes.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== "content-encoding" &&
        lowerKey !== "content-length" &&
        lowerKey !== "transfer-encoding"
      ) {
        responseHeaders.set(key, value);
      }
    });

    return new Response(backendRes.body, {
      status: backendRes.status,
      statusText: backendRes.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        detail: `Backend proxy error: ${errorMsg}. Ensure backend is running at ${BACKEND_URL}.`,
      },
      { status: 503 },
    );
  }
}
