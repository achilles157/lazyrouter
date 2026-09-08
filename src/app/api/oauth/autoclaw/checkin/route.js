import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { claimAllCheckinTasks } from "open-sse/services/autoclawRewards.js";
import { getAutoclawBalance } from "open-sse/services/usage/autoclaw.js";

export const dynamic = "force-dynamic";

// POST /api/oauth/autoclaw/checkin           → all active autoclaw connections
// POST /api/oauth/autoclaw/checkin?connectionId=<id> → one connection
export async function POST(request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");

  try {
    const connections = await getProviderConnections({ provider: "autoclaw" });
    const targets = connectionId
      ? connections.filter((c) => c.id === connectionId)
      : connections.filter((c) => c.isActive !== false);

    if (targets.length === 0) {
      return NextResponse.json({ error: "No autoclaw connections found" }, { status: 404 });
    }

    const results = [];
    for (const conn of targets) {
      const balanceBefore = await getAutoclawBalance(conn.accessToken, conn.providerSpecificData)
        .then((r) => r.balance).catch(() => null);
      const tasks = await claimAllCheckinTasks(conn.accessToken);
      const balanceAfter = await getAutoclawBalance(conn.accessToken, conn.providerSpecificData)
        .then((r) => r.balance).catch(() => null);

      results.push({
        connectionId: conn.id,
        name: conn.name,
        balanceBefore,
        balanceAfter,
        tasks,
      });
    }

    return NextResponse.json({ success: true, results });
  } catch (e) {
    console.log("autoclaw checkin error:", e.message);
    return NextResponse.json({ error: e.message }, { status: e.recoverable ? 503 : 502 });
  }
}
