import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

export const dynamic = "force-dynamic";

const QODER_PROVIDER_ID = "qoder";
const PAT_PREFIX = "pt-";

async function fetchQoderUserInfo(pat) {
  try {
    // Exchange PAT for job token first
    const exchangeRes = await fetch("https://openapi.qoder.sh/api/v1/jobToken/exchange", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "qodercli/1.0.0",
      },
      body: JSON.stringify({ personal_token: pat }),
    });
    if (!exchangeRes.ok) return { email: null, name: null, userId: null };
    const exchangeData = await exchangeRes.json();
    const jobToken = exchangeData.token;
    if (!jobToken) return { email: null, name: null, userId: null };

    // Fetch user info with job token
    const infoRes = await fetch("https://openapi.qoder.sh/api/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${jobToken}`,
        Accept: "application/json",
      },
    });
    if (!infoRes.ok) return { email: null, name: null, userId: null };
    const info = await infoRes.json();
    return {
      email: info.email || info.user_email || null,
      name: info.name || info.user_name || null,
      userId: info.user_id || info.userId || null,
    };
  } catch {
    return { email: null, name: null, userId: null };
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const rawTokens = body?.tokens;

    if (!rawTokens || (typeof rawTokens !== "string" && !Array.isArray(rawTokens))) {
      return NextResponse.json(
        { error: "Provide tokens as a string (one per line) or array" },
        { status: 400 }
      );
    }

    const tokenList = Array.isArray(rawTokens)
      ? rawTokens.map((t) => String(t || "").trim()).filter(Boolean)
      : String(rawTokens).split(/[\r\n]+/).map((t) => t.trim()).filter(Boolean);

    if (tokenList.length === 0) {
      return NextResponse.json({ error: "At least one PAT is required" }, { status: 400 });
    }

    const results = [];

    for (const pat of tokenList) {
      if (!pat.startsWith(PAT_PREFIX)) {
        results.push({
          token: pat.substring(0, 12) + "...",
          status: "failed",
          error: `Invalid format: PAT must start with '${PAT_PREFIX}'`,
        });
        continue;
      }

      try {
        const userInfo = await fetchQoderUserInfo(pat);
        const email = userInfo.email || `qoder-pat-${pat.substring(3, 11)}`;

        const connection = await createProviderConnection({
          provider: QODER_PROVIDER_ID,
          authType: "apikey",
          apiKey: pat,
          accessToken: pat,
          email,
          displayName: userInfo.name || email,
          providerSpecificData: {
            authMode: "pat",
            userId: userInfo.userId || "",
            patPrefix: pat.substring(0, 8),
          },
          testStatus: userInfo.email ? "active" : "unknown",
        });

        results.push({
          email,
          status: "success",
          connectionId: connection.id,
        });
      } catch (error) {
        results.push({
          token: pat.substring(0, 12) + "...",
          status: "failed",
          error: error.message || "Failed to import PAT",
        });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      success: true,
      imported: successCount,
      failed: failedCount,
      total: tokenList.length,
      results,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to import PATs" }, { status: 500 });
  }
}
