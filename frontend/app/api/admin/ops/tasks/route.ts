import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
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
  const backendUrl = new URL(`${API_BASE}/ops/tasks`);
  url.searchParams.forEach((value, key) => {
    backendUrl.searchParams.set(key, value);
  });

  const res = await fetch(backendUrl.toString(), {
    headers: { "x-master-key": MASTER_KEY },
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const err = requireKey();
  if (err) return err;

  const body = await req.text();
  const res = await fetch(`${API_BASE}/ops/tasks`, {
    method: "POST",
    headers: {
      "x-master-key": MASTER_KEY,
      "content-type": "application/json",
    },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
