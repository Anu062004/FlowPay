import { NextRequest, NextResponse } from "next/server";
import { getServerBackendBase } from "@/lib/serverBackendBase";

export const dynamic = "force-dynamic";

const API_BASE = getServerBackendBase();
const MASTER_KEY = process.env.FLOWPAY_ADMIN_MASTER_KEY ?? process.env.MASTER_KEY ?? "";

function requireKey() {
  if (!MASTER_KEY) {
    return NextResponse.json({ error: "Admin master key not configured" }, { status: 500 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const err = requireKey();
  if (err) return err;

  const url = new URL(req.url);
  const backendUrl = new URL(`${API_BASE}/ops/support/insights`);
  url.searchParams.forEach((value, key) => {
    backendUrl.searchParams.set(key, value);
  });

  const res = await fetch(backendUrl.toString(), {
    headers: { "x-master-key": MASTER_KEY },
    cache: "no-store"
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
