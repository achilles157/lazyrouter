import { randomUUID } from "crypto";
import { DATA_DIR } from "../../dataDir.js";
import path from "node:path";
import {
  KiroBulkImportManager,
  buildLookupResponse,
  createFreshContext,
  parseKiroBulkAccounts,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
} from "./kiroBulkImportManager.js";
import { runGoogleAccountAutomation } from "./googleAutomation.js";

const ANTIGRAVITY_PROVIDER_ID = "antigravity";
const ANTIGRAVITY_LABEL = "Antigravity";
const ANTIGRAVITY_STORAGE_NAME = "antigravity-bulk-import";
const ANTIGRAVITY_ONBOARD_MAX_RETRIES = 10;
const ANTIGRAVITY_ONBOARD_POLL_MS = 5000;

// ---------------------------------------------------------------------------
// Callback monitor — watches all frames/requests in a Playwright context for
// a navigation to /callback?code=... (standard OAuth redirect).
// Returns a Promise<{ code, state, callbackUrl }>.
// ---------------------------------------------------------------------------
export function createAntigravityCallbackMonitor(context, page, redirectUri, timeoutMs = 15 * 60_000) {
  let resolveOuter;
  let rejectOuter;
  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  let settled = false;
  const trackedPages = new Set();
  const contextCleanups = new Map();
  const timeoutHandle = setTimeout(() => {
    settle(null, new Error("Timed out waiting for Antigravity OAuth callback"));
  }, timeoutMs);

  // Parse the base path we're watching for (e.g. "http://localhost:20128/callback")
  let callbackBase;
  try {
    const u = new URL(redirectUri);
    callbackBase = u.origin + u.pathname; // e.g. "http://localhost:20128/callback"
  } catch {
    callbackBase = redirectUri;
  }

  function parseCallbackUrl(rawUrl) {
    if (!rawUrl || !rawUrl.startsWith("http")) return null;
    let u;
    try { u = new URL(rawUrl); } catch { return null; }
    // Match on pathname only so port differences don't matter
    if (!u.pathname.endsWith("/callback")) return null;
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    if (!code) return null;
    return { code, state, callbackUrl: rawUrl };
  }

  function settle(result, error = null) {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutHandle);
    for (const fns of contextCleanups.values()) {
      for (const fn of fns) { try { fn(); } catch {} }
    }
    contextCleanups.clear();
    if (error) rejectOuter(error);
    else resolveOuter(result);
  }

  function registerPage(trackedPage, ownerCleanups) {
    if (!trackedPage || trackedPages.has(trackedPage)) return;
    trackedPages.add(trackedPage);

    const onFrame = (frame) => {
      const parsed = parseCallbackUrl(frame?.url?.() || "");
      if (parsed) settle(parsed);
    };
    const onRequest = (request) => {
      const parsed = parseCallbackUrl(request?.url?.() || "");
      if (parsed) settle(parsed);
    };
    const onRequestFailed = (request) => {
      const parsed = parseCallbackUrl(request?.url?.() || "");
      if (parsed) settle(parsed);
    };

    trackedPage.on("framenavigated", onFrame);
    trackedPage.on("request", onRequest);
    trackedPage.on("requestfailed", onRequestFailed);
    ownerCleanups.push(() => {
      trackedPage.off("framenavigated", onFrame);
      trackedPage.off("request", onRequest);
      trackedPage.off("requestfailed", onRequestFailed);
    });

    // Check current URL immediately in case already landed
    const current = parseCallbackUrl(trackedPage.url?.() || "");
    if (current) settle(current);
  }

  function bind(ctx, pg) {
    if (settled) return;
    if (contextCleanups.has(ctx)) return;
    const cleanups = [];
    contextCleanups.set(ctx, cleanups);

    const onPage = (newPage) => registerPage(newPage, cleanups);
    ctx.on("page", onPage);
    cleanups.push(() => ctx.off("page", onPage));
    if (pg) registerPage(pg, cleanups);
  }

  bind(context, page);

  promise.rebind = ({ context: newContext, page: newPage } = {}) => {
    if (newContext) bind(newContext, newPage);
  };

  return promise;
}

// ---------------------------------------------------------------------------
// Google automation wrapper for Antigravity
// ---------------------------------------------------------------------------
export async function runAntigravityGoogleAutomation({
  page,
  authUrl,
  email,
  password,
  callbackPromise,
  shortTimeoutMs,
  onStep,
}) {
  return runGoogleAccountAutomation({
    page,
    authUrl,
    email,
    password,
    successPromise: callbackPromise,
    shortTimeoutMs,
    serviceLabel: ANTIGRAVITY_LABEL,
    openingStep: "opening_antigravity_oauth",
    openingMessage: "Opening Antigravity Google OAuth page",
    successStep: "antigravity_callback_received",
    successMessage: "Antigravity OAuth callback received",
    onStep,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers — call the router's own OAuth API endpoints
// ---------------------------------------------------------------------------

async function defaultGenerateAntigravityAuthData(redirectUri) {
  const { generateAuthData } = await import("../providers.js");
  return generateAuthData(ANTIGRAVITY_PROVIDER_ID, redirectUri);
}

async function defaultExchangeAntigravityTokens(code, redirectUri, codeVerifier, state) {
  const { exchangeTokens } = await import("../providers.js");
  return exchangeTokens(ANTIGRAVITY_PROVIDER_ID, code, redirectUri, codeVerifier, state);
}

async function defaultSaveAntigravityConnection(tokenData, email) {
  const { createProviderConnection } = await import("../../../models/index.js");
  return createProviderConnection({
    provider: ANTIGRAVITY_PROVIDER_ID,
    authType: "oauth",
    ...tokenData,
    email,
    expiresAt: tokenData.expiresIn
      ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
      : null,
    testStatus: "active",
  });
}

async function defaultLoadCodeAssist(accessToken) {
  const { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } = await import("../constants/oauth.js");
  const metadata = getOAuthClientMetadata();
  const response = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
      "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
    },
    body: JSON.stringify({ metadata }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`loadCodeAssist failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  let projectId = data.cloudaicompanionProject;
  if (typeof projectId === "object" && projectId?.id) projectId = projectId.id;
  let tierId = "legacy-tier";
  if (Array.isArray(data.allowedTiers)) {
    for (const tier of data.allowedTiers) {
      if (tier.isDefault && tier.id) { tierId = tier.id.trim(); break; }
    }
  }
  return { projectId: String(projectId || "").trim(), tierId, raw: data };
}

async function defaultOnboardUser(accessToken, tierId) {
  const { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } = await import("../constants/oauth.js");
  const metadata = getOAuthClientMetadata();
  const response = await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
      "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
    },
    body: JSON.stringify({ tierId, metadata }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`onboardUser failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function completeOnboarding(accessToken, tierId, onStep) {
  for (let i = 0; i < ANTIGRAVITY_ONBOARD_MAX_RETRIES; i++) {
    const result = await defaultOnboardUser(accessToken, tierId);
    if (result.done === true) {
      let finalProjectId = null;
      if (result.response?.cloudaicompanionProject) {
        const rp = result.response.cloudaicompanionProject;
        finalProjectId = typeof rp === "string" ? rp.trim() : rp?.id?.trim() || null;
      }
      return { success: true, projectId: finalProjectId };
    }
    onStep?.("onboarding_antigravity", `Waiting for Antigravity onboarding (attempt ${i + 1}/${ANTIGRAVITY_ONBOARD_MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, ANTIGRAVITY_ONBOARD_POLL_MS));
  }
  throw new Error("Antigravity onboarding timed out after max retries");
}

// Build the redirect URI: point to the router's own /callback endpoint
function buildRedirectUri() {
  const port = process.env.PORT || "20128";
  return `http://localhost:${port}/callback`;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------
export class AntigravityBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    googleAutomation = runAntigravityGoogleAutomation,
    generateAuthDataFn = defaultGenerateAntigravityAuthData,
    exchangeTokensFn = defaultExchangeAntigravityTokens,
    saveConnectionFn = defaultSaveAntigravityConnection,
    loadCodeAssistFn = defaultLoadCodeAssist,
  } = {}) {
    super({
      browserLauncher,
      googleAutomation,
      storageName: ANTIGRAVITY_STORAGE_NAME,
    });
    this.generateAuthData = generateAuthDataFn;
    this.exchangeTokens = exchangeTokensFn;
    this.saveConnection = saveConnectionFn;
    this.loadCodeAssist = loadCodeAssistFn;
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const redirectUri = buildRedirectUri();
    const { context, page } = await createFreshContext(browser);
    account.runtimeSession = { context, page, proxyUrl: browser.__ninerouterProxyUrl || job.proxyUrl || null };

    let authData;
    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} preparing browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });

      this.setAccountStep(account, "generating_auth_url", "Generating Antigravity OAuth authorization URL");
      authData = await this.generateAuthData(redirectUri);
      if (!authData?.authUrl) throw new Error("No authUrl returned from generateAuthData");
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Failed to generate Antigravity auth URL",
        step: "auth_url_failed",
        message: error.message || "Failed to generate Antigravity auth URL",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
      return;
    }

    const callbackPromise = createAntigravityCallbackMonitor(context, page, redirectUri);
    callbackPromise.catch(() => null); // prevent unhandled rejection

    try {
      const automationResult = await this.googleAutomation({
        page,
        authUrl: authData.authUrl,
        email: account.email,
        password: account.password,
        callbackPromise,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        // Callback was captured — extract code from the resolved promise
        let callbackResult;
        try {
          callbackResult = await Promise.race([
            callbackPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("callback timeout")), 5000)),
          ]);
        } catch {
          // automationResult.code may be set directly (successPromise resolved with it)
          callbackResult = automationResult.code
            ? { code: automationResult.code, state: authData.state }
            : null;
        }

        if (!callbackResult?.code) {
          this.finalizeAccount(account, "failed", {
            error: "OAuth callback received but authorization code was missing",
            step: "callback_no_code",
            message: "OAuth callback received but authorization code was missing",
          });
          account.runtimeSession = null;
          await context.close().catch(() => null);
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        this.setAccountStep(account, "exchanging_tokens", "Exchanging Antigravity OAuth code for tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });

        const tokenData = await this.exchangeTokens(
          callbackResult.code,
          redirectUri,
          authData.codeVerifier,
          callbackResult.state || authData.state,
        );

        const accessToken = tokenData.accessToken || tokenData.access_token;
        if (!accessToken) throw new Error("Token exchange succeeded but no accessToken returned");

        this.setAccountStep(account, "loading_code_assist", "Loading Antigravity Code Assist project");
        await this.persistJobSnapshot(job, { forcePreview: true });

        let projectId = tokenData.projectId || null;
        if (!projectId) {
          const { projectId: pid, tierId } = await this.loadCodeAssist(accessToken);
          projectId = pid;
          if (projectId) {
            this.setAccountStep(account, "onboarding_antigravity", "Onboarding Antigravity Code Assist");
            await this.persistJobSnapshot(job, { forcePreview: true });
            const onboardResult = await completeOnboarding(accessToken, tierId, (step, message) => {
              this.setAccountStep(account, step, message);
              void this.persistJobSnapshot(job, { forcePreview: false });
            });
            if (onboardResult.projectId) projectId = onboardResult.projectId;
          }
        }

        this.setAccountStep(account, "saving_connection", "Saving Antigravity connection");
        await this.persistJobSnapshot(job, { forcePreview: true });

        const connection = await this.saveConnection(
          { ...tokenData, projectId: projectId || null },
          account.email,
        );

        this.finalizeAccount(account, "success", {
          connectionId: connection.id || connection?.connection?.id,
          step: "connection_saved",
          message: "Antigravity connection saved successfully",
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          opened: false,
          openedAt: null,
          rebind: typeof callbackPromise?.rebind === "function" ? callbackPromise.rebind : null,
        };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion in the browser session");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
        // Manual followup uses base class runManualFollowup which calls socialExchange —
        // for Antigravity we override this to call exchangeTokens instead.
        await this.runAntigravityManualFollowup(job, account, workerId, context, callbackPromise, authData, redirectUri);
        return;
      }

      const terminalStatus = ["failed", "failed_invalid_credentials", "failed_timeout", "cancelled"].includes(automationResult.status)
        ? automationResult.status
        : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Antigravity Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Antigravity Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", { error: "Job cancelled", step: "cancelled", message: "Job cancelled" });
      } else {
        this.finalizeAccount(account, "failed", {
          error: error.message || "Unexpected Antigravity bulk import failure.",
          step: "failed",
          message: error.message || "Unexpected Antigravity bulk import failure.",
        });
      }
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }

  async runAntigravityManualFollowup(job, account, workerId, context, callbackPromise, authData, redirectUri) {
    const followupPromise = (async () => {
      const closeManualResources = async () => {
        const ms = account.manualSession;
        const ctx = ms?.context || context;
        const headed = ms?.headedBrowser || null;
        if (ctx) await ctx.close().catch(() => null);
        if (headed) await headed.close().catch(() => null);
      };
      try {
        const callback = await callbackPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", { error: "Job cancelled", step: "cancelled", message: "Job cancelled" });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        this.setAccountStep(account, "exchanging_tokens", "Exchanging Antigravity OAuth code for tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });

        const tokenData = await this.exchangeTokens(
          callback.code,
          redirectUri,
          authData.codeVerifier,
          callback.state || authData.state,
        );

        const accessToken = tokenData.accessToken || tokenData.access_token;
        let projectId = tokenData.projectId || null;
        if (!projectId && accessToken) {
          const { projectId: pid, tierId } = await this.loadCodeAssist(accessToken);
          projectId = pid;
          if (projectId) {
            const onboardResult = await completeOnboarding(accessToken, tierId, (step, message) => {
              this.setAccountStep(account, step, message);
              void this.persistJobSnapshot(job, { forcePreview: false });
            }).catch(() => ({ projectId: null }));
            if (onboardResult.projectId) projectId = onboardResult.projectId;
          }
        }

        const connection = await this.saveConnection(
          { ...tokenData, projectId: projectId || null },
          account.email,
        );
        this.finalizeAccount(account, "success", {
          connectionId: connection.id || connection?.connection?.id,
          step: "connection_saved",
          message: "Antigravity connection saved successfully",
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", { error: "Job cancelled", step: "cancelled", message: "Job cancelled" });
        } else {
          this.finalizeAccount(account, "failed_exchange", {
            error: error.message || "Manual assist flow failed during token exchange.",
            step: "exchange_failed",
            message: error.message || "Manual assist flow failed during token exchange.",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        await closeManualResources();
        account.manualSession = null;
        account.runtimeSession = null;
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();
    job.manualFollowups.add(followupPromise);
  }
}

function getSingletonStore() {
  if (!globalThis.__antigravityBulkImportSingleton) {
    globalThis.__antigravityBulkImportSingleton = {
      manager: new AntigravityBulkImportManager(),
    };
  }
  return globalThis.__antigravityBulkImportSingleton;
}

export function getAntigravityBulkImportManager() {
  return getSingletonStore().manager;
}

export {
  buildLookupResponse,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY as ANTIGRAVITY_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY as ANTIGRAVITY_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY as ANTIGRAVITY_BULK_IMPORT_MIN_CONCURRENCY,
  parseKiroBulkAccounts as parseAntigravityBulkAccounts,
};
