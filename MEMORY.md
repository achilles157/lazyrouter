# LazyRouter Project Memory

## Project Overview
- **Name:** LazyRouter (custom AI router fork of `decolua/9router`)
- **Repository:** https://github.com/achilles157/lazyrouter (public, branch `main`)
- **Local Workspace:** `C:\Users\Falah\Documents\code\lazyrouter`
- **Port:** 20128 | **CLI binary:** `lazyrouter`
- **Data Directory:** `C:\Users\Falah\AppData\Roaming\lazyrouter`
  - Database: `AppData\Roaming\lazyrouter\db\data.sqlite` (table: `providerConnections`)
- **Core Purpose:** Multi-provider AI proxy router with automated bulk account onboarding (Antigravity, CodeBuddy, Qoder, AutoClaw, Kiro) and context token saver.

---

## Technical Architecture & Hard-Won Lessons

### 1. Kiro (AWS CodeWhisperer)
- **Strict Payload Schema:** AWS CodeWhisperer strictly rejects any unexpected top-level JSON fields (returns `400 REQUEST_BODY_INVALID`).
  - In `open-sse/executors/kiro.js`, `args.body.systemPrompt` and `args.body.model` MUST be stripped before calling `super.execute()`.
  - System prompts (Caveman/Ponytail) are already merged into history `contentPrefix` via `applyKiroSessionReplay`.
- **Opus Fallback:** AWS CodeWhisperer free tier does not support Opus. Any model containing `opus` is silently routed to `claude-sonnet-4.5` in `open-sse/config/kiroConstants.js`.
- **Database Quarantine:** Repeated 400 errors set `errorCode = 400` and `backoffLevel > 0` on Kiro accounts in `data.sqlite`. Reset these fields to restore locked accounts.
- **Context Threshold:** Clear `.openclaw/tmp/*.jsonl` if AutoClaw hits `CONTENT_LENGTH_EXCEEDS_THRESHOLD` (happens when accumulated session history crosses ~400-500 KB).

### 2. Headroom Token Saver
- **Port:** Runs as a standalone Python compressor at `http://127.0.0.1:8787/v1/compress`.
- **CLI Startup:** `headroom proxy --port 8787` (subcommand `proxy` is mandatory).
- **Recommended Extras:** Use `[code]` for AST compression. Keep `[ml]` (Kompress-v2) **uninstalled/disabled** on standard CPUs to avoid 5-10s timeout aborts.
- **Observability:** Dashboard URL `/api/headroom/proxy/dashboard` is a legacy route (returns 404 in v0.37.0). Use native dashboard at `http://127.0.0.1:8787/dashboard` or check LazyRouter CLI logs (`[HEADROOM] reported token delta`).

### 3. AutoClaw vs Z.ai Web
- **AutoClaw Backend:** `https://autoglm-api.autoglm.ai`.
  - Signed headers via MD5 hash of `APP_ID (100003) + ts + APP_KEY (38d2391985e2369a5fb8227d8e6cd5e5)`.
  - Auth header: `X-Authorization: Bearer <accessToken>`.
  - Model: `zai_glm-5-turbo` (other model strings return `非法模型` on free/sub tiers).
  - Token refresh: `POST /userapi/v1/refresh` with `{ source_id: "web", device_id, refresh_token }` — zero CAPTCHA on backend.
- **Cloudflare Turnstile Workaround:** `autoclaw.z.ai/web/` blocks headless Playwright. To import, log in once via standard Chrome, extract tokens from `localStorage` (`autoclaw.web.authToken`, `autoclaw.web.refreshToken`, `deviceId`), and import via the "Import Account" modal or directly to `data.sqlite`.
- **Z.ai Chat Web (`chat.z.ai`):** Requires dynamic one-time tokens (`captcha_verify_param` from Alibaba Cloud WAF) on every single message to `POST /api/v2/chat/completions`. Unsuitable for raw API proxying.

### 4. CodeBuddy (Tencent Cloud)
- **Free Tier Models:** `default-model`, `deepseek-v3-0324`, `glm-5.0` are active. `gemini-*` and `default-model-lite` are Pro-only (throw error 11102).
- **Model Registry:** CodeBuddy lacks a public model catalog endpoint. Registry in `open-sse/providers/registry/codebuddy.js` must be maintained manually.

### 5. Google / GSuite OAuth Automation
- **Bot Detection:** Google blocks default Playwright Chromium and Camoufox ("This browser or app may not be secure").
- **Solution:** Use the "Chrome Real" engine in `src/lib/oauth/services/bulkImportBrowserEngine.js` which spawns the user's installed Google Chrome with `--remote-debugging-port` and connects via CDP.

### 6. Per-API-Key ACL & Scope Safety
- **Scope Leak Bug (Resolved):** In commit `c24b52d9`, `isProviderAllowed(apiKeyInfo, provider)` was added inside `handleSingleModelChat`, but `apiKeyInfo` was only declared in `handleChat` and never passed down. This caused `ReferenceError: apiKeyInfo is not defined` on all incoming `/v1/chat/completions` and `/v1/messages` calls.
- **Fix:** Resolved `apiKeyInfo` when an API key is provided, passed `apiKeyInfo` through all single-model and combo dispatch routes down to `handleSingleModelChat`, and defaulted `apiKeyInfo = null` in the function signature.

### 7. Loop Guard Event Loop Starvation & Dashboard Hang (Resolved)
- **Symptom:** LazyRouter freezes at 100% CPU on single-thread Node.js event loop. Accessing `http://localhost:20128` or `/dashboard` or `/api/health` hangs with 0 bytes received or connection reset.
- **Root Cause:** In `open-sse/utils/loopGuard.js`, `detectSequenceRepeat(seq)` ran an unbounded O(N^4) nested loop with `seq.slice().join("|")` across the full history. On large conversation histories (e.g. 500-1,400 messages sent by Claude Code), it took 10-25+ minutes of continuous CPU compute, locking the Node.js event loop.
- **Fix:**
  1. Fast O(L) tail repeat check directly via index comparisons without string allocation (detects active loops at execution tail).
  2. Bounded sliding window search to the last 30 tool calls (`RECENT_TOOL_WINDOW = 30`) and max period 8 (`MAX_SEQUENCE_LENGTH = 8`).
  3. Bounded text repeat detection to the last 10 assistant messages (`RECENT_ASSISTANT_MSGS = 10`).
  4. Execution time dropped from >20 minutes to <0.6 milliseconds.


---

## Standard Rebuild & Packing Workflow
When editing server or open-sse code:
```powershell
cd C:\Users\Falah\Documents\code\lazyrouter
npm run build          # ~3-5 min
npm run cli:pack       # creates tgz
Get-Process node | ? { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match 'lazyrouter|wyxrouter' } | Stop-Process -Force
npm install -g C:\Users\Falah\Documents\code\lazyrouter-1.0.0.tgz
Start-Process lazyrouter -WindowStyle Hidden
```

---

## Session History References
- `memory/lazyrouter-2026-09-01.md`: Fork migration, CodeBuddy reverse engineering, and build infrastructure restoration.
- `memory/lazyrouter-2026-09-03.md`: Deep dive debugging on Kiro schema crash, Headroom proxy timeout tuning, AutoClaw wallet reverse engineering, and Z.ai WAF analysis.
- `memory/lazyrouter-2026-09-08.md`: Fixed `ReferenceError: apiKeyInfo is not defined` regression from ACL feature merge in `src/sse/handlers/chat.js`. Process and port cleanup.
