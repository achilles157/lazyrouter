// AutoClaw rewards service — ported from hirotomasato/autoclawpi.
// Covers: daily check-in tasks, newbie 100M-token claim, promotion rewards.
// All endpoints live on the /autoclaw-proxy/proxy/* path with signed-ish headers:
//   - task-complete uses signed userapi headers + lowercase authorization
//   - newbie-guide / promotion-reward use ONLY X-Authorization (uppercase, no X-Auth-*)

import {
  AUTOCLAW_BASE_URL,
  autoclawUserapiHeaders,
} from "../utils/autoclawSign.js";

// Daily tasks known to pay out (from autoclawpi checkin.go).
export const CHECKIN_TASKS = [
  { id: "daily_signin", points: 400 },
  { id: "daily_inspiration_center", points: 200 },
  { id: "newbie_cloud_lobster", points: 500 },
  { id: "newbie_local_lobster", points: 500 },
];

function bearer(token) {
  return `Bearer ${String(token || "").replace(/^Bearer\s+/i, "")}`;
}

/**
 * Claim a single daily task. Returns { ok, alreadyCompleted, points, message }.
 */
export async function claimAutoclawTask(accessToken, taskId, proxyOptions = null) {
  if (!accessToken) throw new Error("autoclaw claimTask: accessToken required");
  if (!taskId) throw new Error("autoclaw claimTask: taskId required");

  const res = await fetch(`${AUTOCLAW_BASE_URL}/autoclaw-proxy/proxy/autoclaw-task-complete`, {
    method: "POST",
    headers: autoclawUserapiHeaders({ authorization: bearer(accessToken) }),
    body: JSON.stringify({ task_id: taskId }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text().catch(() => "");
  let json = {};
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  const data = json.data;

  if (!data) {
    throw Object.assign(
      new Error(`autoclaw claimTask ${taskId}: HTTP ${res.status} ${text.slice(0, 200)}`),
      { recoverable: res.status >= 500 }
    );
  }
  if (data.already_completed) {
    return { ok: true, alreadyCompleted: true, points: 0 };
  }
  if (!data.success) {
    throw new Error(`autoclaw claimTask ${taskId}: server success=false`);
  }
  return { ok: true, alreadyCompleted: false, points: Number(data.reward_points || 0) };
}

/**
 * Claim all daily tasks for one account.
 * Returns per-task results; never throws for individual task failures.
 */
export async function claimAllCheckinTasks(accessToken) {
  const results = [];
  for (const task of CHECKIN_TASKS) {
    try {
      const r = await claimAutoclawTask(accessToken, task.id);
      results.push({ taskId: task.id, expectedPoints: task.points, ...r });
    } catch (e) {
      results.push({ taskId: task.id, expectedPoints: task.points, ok: false, error: e.message });
    }
  }
  return results;
}

/**
 * Claim the newbie 100M-token guide reward. Returns the guide token string.
 * NOTE: uses plain X-Authorization header (no X-Auth-* signing) per autoclawpi.
 */
export async function claimAutoclawNewbieToken(accessToken) {
  if (!accessToken) throw new Error("autoclaw newbie: accessToken required");

  const res = await fetch(`${AUTOCLAW_BASE_URL}/autoclaw-proxy/proxy/autoclaw-newbie-guide/token`, {
    method: "POST",
    headers: {
      "x-authorization": bearer(accessToken),
      accept: "application/json",
      "user-agent": "AutoClaw/1.17.9",
    },
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text().catch(() => "");
  if (res.status >= 400) {
    throw Object.assign(
      new Error(`autoclaw newbie claim: HTTP ${res.status} ${text.slice(0, 300)}`),
      { recoverable: res.status >= 500 }
    );
  }
  let json = {};
  try { json = JSON.parse(text); } catch {
    throw new Error(`autoclaw newbie claim: non-JSON response ${text.slice(0, 200)}`);
  }
  const token = json.token;
  if (!token) throw new Error(`autoclaw newbie claim: empty token ${text.slice(0, 300)}`);
  return token;
}

/**
 * Claim a promotion reward (modal_id + reward_type). Returns raw JSON.
 * NOTE: uses plain X-Authorization header (no X-Auth-* signing) per autoclawpi.
 */
export async function claimAutoclawPromotionReward(accessToken, modalId, rewardType) {
  if (!accessToken) throw new Error("autoclaw promotion: accessToken required");

  const res = await fetch(`${AUTOCLAW_BASE_URL}/autoclaw-proxy/proxy/autoclaw-promotion-reward`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-authorization": bearer(accessToken),
      accept: "application/json",
      "user-agent": "AutoClaw/1.17.9",
    },
    body: JSON.stringify({ modal_id: modalId, reward_type: rewardType }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text().catch(() => "");
  if (res.status >= 400) {
    throw Object.assign(
      new Error(`autoclaw promotion claim: HTTP ${res.status} ${text.slice(0, 300)}`),
      { recoverable: res.status >= 500 }
    );
  }
  try { return JSON.parse(text); } catch {
    throw new Error(`autoclaw promotion claim: non-JSON response ${text.slice(0, 200)}`);
  }
}
