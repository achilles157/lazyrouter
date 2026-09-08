import { NextResponse } from "next/server";
import {
  getAutoclawCaptchaConfig,
  requestAutoclawOAuthUrl,
  autoclawOAuthLogin,
} from "open-sse/services/autoclawOauth.js";
import { autoclawService } from "@/lib/oauth/services/autoclaw";

export const dynamic = "force-dynamic";

// GET /api/oauth/autoclaw/oauth-url?vendor=google&captchaParam=<verifyParam>
// Returns { captcha: config|null, oauthUrl, state }
export async function GET(request) {
  const url = new URL(request.url);
  const vendor = url.searchParams.get("vendor") || "google";
  const captchaParam = url.searchParams.get("captchaParam");

  try {
    let captcha = null;
    try {
      captcha = await getAutoclawCaptchaConfig();
    } catch {
      // Captcha config is advisory — proceed without it.
    }
    const { oauthUrl, state } = await requestAutoclawOAuthUrl({ vendor, captchaParam });
    return NextResponse.json({ captcha, oauthUrl, state });
  } catch (e) {
    console.log("autoclaw oauth-url error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

// POST /api/oauth/autoclaw/oauth-url  { vendor, code, state }
// Exchanges the OAuth code for tokens and saves the connection (same shape as
// the manual import-token route).
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { vendor = "google", code, state } = body;

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  try {
    const tokens = await autoclawOAuthLogin({ vendor, code, state });
    const result = await autoclawService.validateAndSaveImport({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      deviceId: undefined,
    });
    return NextResponse.json({ success: true, connection: result });
  } catch (e) {
    console.log("autoclaw oauth-login error:", e.message);
    const status = e.code === "INVALID_TOKEN" ? 400 : e.recoverable ? 503 : 502;
    return NextResponse.json({ error: e.message }, { status });
  }
}
