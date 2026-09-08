import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { claimAutoclawNewbieToken, claimAutoclawPromotionReward } from "open-sse/services/autoclawRewards.js";

export const dynamic = "force-dynamic";

// POST /api/oauth/autoclaw/claim?connectionId=<id>&type=newbie
// POST /api/oauth/autoclaw/claim?connectionId=<id>&type=promotion&modalId=<id>&rewardType=<t>
export async function POST(request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");
  const type = url.searchParams.get("type");

  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }
  if (type !== "newbie" && type !== "promotion") {
    return NextResponse.json({ error: 'type must be "newbie" or "promotion"' }, { status: 400 });
  }
  if (type === "promotion" && (!url.searchParams.get("modalId") || !url.searchParams.get("rewardType"))) {
    return NextResponse.json({ error: "promotion requires modalId and rewardType" }, { status: 400 });
  }

  try {
    const conn = await getProviderConnectionById(connectionId);
    if (!conn || conn.provider !== "autoclaw") {
      return NextResponse.json({ error: "Autoclaw connection not found" }, { status: 404 });
    }

    if (type === "newbie") {
      const token = await claimAutoclawNewbieToken(conn.accessToken);
      return NextResponse.json({ success: true, type, token });
    }

    const reward = await claimAutoclawPromotionReward(
      conn.accessToken,
      url.searchParams.get("modalId"),
      url.searchParams.get("rewardType"),
    );
    return NextResponse.json({ success: true, type, reward });
  } catch (e) {
    console.log("autoclaw claim error:", e.message);
    return NextResponse.json({ error: e.message }, { status: e.recoverable ? 503 : 502 });
  }
}
