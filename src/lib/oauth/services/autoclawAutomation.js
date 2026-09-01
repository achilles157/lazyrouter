import { runGoogleAccountAutomation } from "./kiroGoogleAutomation.js";

const AUTOCLAW_WEB_URL = "https://autoclaw.z.ai/web/";
const DEFAULT_SHORT_TIMEOUT_MS = 90_000;
const DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60_000;

// Selectors for AutoClaw web login gate
// UI as of 2026-08-22:
//   Landing page shows ONE button: "Try for free".
//   Clicking it opens a modal with TWO options:
//     - "Continue with Zai"  (via chat.z.ai popup)
//     - "Continue with Google" (DIRECT Google OAuth — no Zai popup needed)
//   Old selectors (去注册, 登录, Sign in) are gone from the landing page.
const AUTOCLAW_LOGIN_BUTTON_SELECTORS = [
  // Current (2026-08-22): landing page CTA
  'button:has-text("Try for free")',
  'button:has-text("Get started")',
  'button:has-text("Start for free")',
  // Legacy fallbacks (pre-2026-08 UI)
  'button:has-text("去注册")',
  'button:has-text("登录")',
  'button:has-text("Sign in")',
  'button:has-text("Login")',
  'button:has-text("Register")',
  'button:has-text("注册")',
  'button:has-text("Sign Up")',
  '[class*="login-gate"] button',
  '[class*="login"] button',
  '[class*="LoginBtn"] button',
  '[class*="login-btn"]',
  '[class*="auth"] button',
  '[data-action*="login"]',
  '[data-action*="signin"]',
  'header button:not([disabled])',
  'nav button:not([disabled])',
  '[class*="header"] button:not([disabled])',
];

// Current (2026-08-22): AutoClaw modal now has a DIRECT Google button.
// Prefer this over Zai popup when available — skips the extra tab/popup step.
const AUTOCLAW_GOOGLE_DIRECT_SELECTORS = [
  'button:has-text("Continue with Google")',
  'button:has-text("Google")',
  '[aria-label*="Google"]',
  '[class*="google"] button',
  'button[class*="Google"]',
];

const AUTOCLAW_ZAI_BUTTON_SELECTORS = [
  'button:has-text("Continue with Zai")',
  'button:has-text("Zai")',
  '[aria-label*="Zai"]',
  '[class*="zai"] button',
  'button:has-text("Z.ai")',
  'a:has-text("Zai")',
  'a:has-text("Z.ai")',
  '[class*="Zai"]',
  '[class*="zai-login"]',
  '[data-provider*="zai"]',
  '[class*="oauth"] button',
  '[class*="social"] button',
];

/**
 * Poll all browser context pages for AutoClaw tokens in localStorage.
 *
 * Flow: after Google login + Z.ai authorize, the popup redirects back to
 * autoclaw.z.ai/web/?webOAuthCallback=zai. The web app processes the callback,
 * stores tokens in localStorage, then may close the popup and refresh tab 0.
 *
 * This monitor polls every 500ms across ALL context pages (popup + main tab)
 * to catch the token regardless of which tab ends up with it.
 */
export function createAutoclawTokenMonitor(context, timeoutMs = DEFAULT_MANUAL_TIMEOUT_MS) {
  let resolveOuter;
  let rejectOuter;
  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  let settled = false;
  let intervalHandle = null;
  const timeoutHandle = setTimeout(() => {
    if (intervalHandle) clearInterval(intervalHandle);
    settle(null, new Error("Timed out waiting for AutoClaw token in localStorage"));
  }, timeoutMs);

  function settle(result, error = null) {
    if (settled) return;
    settled = true;
    if (intervalHandle) clearInterval(intervalHandle);
    clearTimeout(timeoutHandle);
    if (error) rejectOuter(error);
    else resolveOuter(result);
  }

  async function checkPage(page) {
    try {
      const url = page.url();
      if (!url.includes("autoclaw.z.ai") && !url.includes("z.ai")) return false;

      const data = await page.evaluate(() => {
        try {
          // Primary key set (Wisyam's original)
          let authToken = localStorage.getItem("autoclaw.web.authToken") || "";
          let refreshToken = localStorage.getItem("autoclaw.web.refreshToken") || "";
          let deviceId = localStorage.getItem("autoclaw.web.deviceId") || "";
          const loginInfoRaw = localStorage.getItem("autoclaw.web.loginInfo") || "{}";
          let loginInfo = {};
          try { loginInfo = JSON.parse(loginInfoRaw); } catch {}

          // Fallback: scan all localStorage keys for token-like values
          // AutoClaw may rename keys across UI updates
          if (!authToken || !refreshToken) {
            const allKeys = Object.keys(localStorage);
            for (const key of allKeys) {
              const val = localStorage.getItem(key) || "";
              if (!authToken && (key.toLowerCase().includes("authtoken") || key.toLowerCase().includes("access_token") || key.toLowerCase().includes("token")) && val.length > 20 && !val.startsWith("{")) {
                authToken = val;
              }
              if (!refreshToken && (key.toLowerCase().includes("refreshtoken") || key.toLowerCase().includes("refresh_token")) && val.length > 20 && !val.startsWith("{")) {
                refreshToken = val;
              }
              if (!deviceId && key.toLowerCase().includes("deviceid") && val.length > 5) {
                deviceId = val;
              }
              if (!loginInfo.user_id && (key.toLowerCase().includes("logininfo") || key.toLowerCase().includes("userinfo") || key.toLowerCase().includes("user_info"))) {
                try { loginInfo = { ...loginInfo, ...JSON.parse(val) }; } catch {}
              }
            }
          }

          return { authToken, refreshToken, deviceId, loginInfo };
        } catch {
          return null;
        }
      });

      if (!data) return false;
      if (!data.authToken || !data.refreshToken) return false;

      settle({
        access_token: data.authToken.replace(/^Bearer\s+/i, ""),
        refresh_token: data.refreshToken.replace(/^Bearer\s+/i, ""),
        user_id: data.loginInfo.user_id || data.loginInfo.userId || "",
        user_name: data.loginInfo.user_name || data.loginInfo.userName || data.loginInfo.username || "",
        device_id: data.deviceId || "",
        first_login: data.loginInfo.first_login ?? false,
      });
      return true;
    } catch {
      // page may be closed or navigating — skip
      return false;
    }
  }

  intervalHandle = setInterval(async () => {
    if (settled) return;
    const pages = context.pages();
    for (const p of pages) {
      if (await checkPage(p)) return;
    }
  }, 500);

  return promise;
}

/**
 * Run the AutoClaw web login flow.
 *
 * UI as of 2026-08-22:
 *   1. Navigate to autoclaw.z.ai/web/
 *   2. Click "Try for free" (new landing CTA) → login modal appears
 *   3a. [PREFERRED] Click "Continue with Google" directly in modal → Google popup
 *   3b. [FALLBACK]  Click "Continue with Zai" → chat.z.ai popup → Google
 *   4. Google email + password + workspace terms + consent
 *   5. Redirect back; token monitor extracts tokens from localStorage
 *
 * Direct Google path (3a) skips the extra Zai tab and Z.ai authorize page,
 * making the flow shorter and less fragile.
 */
export async function runAutoclawGoogleAutomation({
  page,
  email,
  password,
  deviceId: _deviceId, // unused — web app generates its own
  callbackPromise,
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  onStep,
}) {
  const reportStep = (step, message) => onStep?.(step, message);

  // 1. Navigate to AutoClaw web app
  reportStep("opening_autoclaw_web", "Opening AutoClaw web app");
  await page.goto(AUTOCLAW_WEB_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000 + Math.floor(Math.random() * 1500));

  // 2. Click entry CTA to open login modal
  reportStep("clicking_autoclaw_login", "Clicking AutoClaw login button");
  const loginClicked = await clickFirstVisible(page, AUTOCLAW_LOGIN_BUTTON_SELECTORS);
  if (!loginClicked) {
    return {
      status: "failed",
      error: "Could not find AutoClaw login button. The web UI may have changed.",
    };
  }
  await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));

  // 3. Try direct Google button first (new UI: modal has both Zai + Google).
  //    If that's not available, fall back to Zai popup flow.
  const context = page.context();
  let popup = null;
  let isPopup = false;

  const googleDirectClicked = await clickFirstVisible(page, AUTOCLAW_GOOGLE_DIRECT_SELECTORS);
  if (googleDirectClicked) {
    reportStep("clicking_google_direct", "Clicking Continue with Google directly");
    // Google OAuth may open in a popup tab or same tab.
    try {
      popup = await context.waitForEvent("page", { timeout: 8_000 });
      await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 });
      isPopup = true;
      reportStep("google_popup_opened", "Google auth popup opened — starting Google login");
    } catch {
      // No popup — same tab redirect
      reportStep("google_same_tab", "No popup detected — Google auth loading in same tab");
      popup = page;
    }
  } else {
    // Fallback: Zai popup flow
    reportStep("clicking_continue_with_zai", "Clicking Continue with Zai");
    const zaiClicked = await clickFirstVisible(page, AUTOCLAW_ZAI_BUTTON_SELECTORS);
    if (!zaiClicked) {
      return {
        status: "failed",
        error: "Could not find 'Continue with Google' or 'Continue with Zai' button on AutoClaw login modal.",
      };
    }

    try {
      popup = await context.waitForEvent("page", { timeout: 10_000 });
      await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 });
      isPopup = true;
      reportStep("zai_popup_opened", "Z.ai auth popup tab opened — starting Google login");
    } catch {
      reportStep("zai_same_tab", "No popup detected — Z.ai auth may load in same tab");
      popup = page;
    }
  }

  // 4. Wait for Google or provider login form to appear.
  try {
    await (popup || page).waitForSelector(
      [
        'button:has-text("Continue with Google")',
        'button:has-text("Google")',
        'a:has-text("Google")',
        '[role="button"]:has-text("Google")',
        'button.ButtonContinueWithGoogle',
        'button[class*="ContinueWithGoogle"]',
        'input[type="email"]',
        'input[autocomplete="username"]',
        'input[placeholder*="Email" i]',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
      ].join(", "),
      { state: "visible", timeout: 15_000 }
    );
  } catch {
    return {
      status: "failed",
      error: "Auth page did not render login form or Google button.",
    };
  }
  reportStep("auth_page_ready", "Auth page ready — starting Google login automation");

  // 5. Run Google account automation.
  const result = await runGoogleAccountAutomation({
    page: popup || page,
    skipNavigation: true,
    email,
    password,
    successPromise: callbackPromise,
    shortTimeoutMs,
    serviceLabel: "AutoClaw",
    openingStep: "starting_google_login",
    openingMessage: "Starting Google login",
    successStep: "autoclaw_token_extracted",
    successMessage: "AutoClaw token extracted from localStorage",
    onStep,
  });

  // 6. Cleanup popup tab if separate.
  if (isPopup && popup !== page) {
    await popup.close().catch(() => null);
  }

  return result;
}

// --- helpers ---

async function clickFirstVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 })) {
        await loc.click({ timeout: 5000 });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}
