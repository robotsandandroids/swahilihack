import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxy";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scenarioId: string }> },
) {
  const { scenarioId } = await params;
  return proxyToBackend(req, `/api/scenarios/${encodeURIComponent(scenarioId)}`);
}
