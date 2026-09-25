import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

export async function POST(req: NextRequest) {
  return proxyToBackend(req, "/api/tts");
}

export async function GET(req: NextRequest) {
  return proxyToBackend(req, "/api/tts");
}
