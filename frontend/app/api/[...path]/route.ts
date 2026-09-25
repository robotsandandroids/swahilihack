import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

type Context = {
  params: Promise<{ path: string[] }>;
};

async function handle(req: NextRequest, { params }: Context) {
  const { path } = await params;
  const pathStr = Array.isArray(path) ? path.join("/") : path;
  return proxyToBackend(req, `/api/${pathStr}`);
}

export async function GET(req: NextRequest, ctx: Context) {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: Context) {
  return handle(req, ctx);
}

export async function PUT(req: NextRequest, ctx: Context) {
  return handle(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: Context) {
  return handle(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: Context) {
  return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: Context) {
  return handle(req, ctx);
}
