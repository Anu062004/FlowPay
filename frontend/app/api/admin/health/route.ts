import { NextResponse } from "next/server";
import { getServerBackendBase } from "@/lib/serverBackendBase";

export const dynamic = "force-dynamic";

const API_BASE = getServerBackendBase();

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: any) {
    return NextResponse.json(
      { status: "down", error: error?.message ?? "Health check failed" },
      { status: 502 }
    );
  }
}
