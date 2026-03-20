import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const MASTER_KEY = process.env.FLOWPAY_ADMIN_MASTER_KEY ?? process.env.MASTER_KEY ?? "";

export async function GET(req: NextRequest) {
  if (!MASTER_KEY) {
    return NextResponse.json({ logs: [] });
  }

  const url = new URL(req.url);
  const backendUrl = new URL(`${API_BASE}/agents/logs`);
  url.searchParams.forEach((value, key) => {
    backendUrl.searchParams.set(key, value);
  });

  try {
    const res = await fetch(backendUrl.toString(), {
      headers: { "x-master-key": MASTER_KEY },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ logs: [] });
    }
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ logs: [] });
  }
}
