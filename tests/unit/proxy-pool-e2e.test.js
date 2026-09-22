// Proxy-pool verification: proves the pool -> credentials -> proxyAwareFetch
// path really routes traffic through a proxy, without needing a real pool.
// The "proxy" here is a loopback HTTP/CONNECT proxy started by the test itself.
//
// Run: cd lazyrouter/tests && npx vitest run unit/proxy-pool-e2e.test.js

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import net from "node:net";

// ── Fake persistence layer so fitness/pool lookups never touch SQLite ────────
const poolFitnessStore = new Map(); // poolId -> Map(scope -> { until, reason })
const poolStore = new Map();        // poolId -> pool row

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(async (id) => poolStore.get(id) || null),
  listProxyPoolFitness: vi.fn(async (poolId) => {
    const scopes = poolFitnessStore.get(poolId);
    return scopes ? [...scopes.entries()].map(([scope, entry]) => ({ poolId, scope, ...entry })) : [];
  }),
  upsertProxyPoolFitness: vi.fn(async (poolId, scope, until, reason = "") => {
    const scopes = poolFitnessStore.get(poolId) || new Map();
    scopes.set(scope, { until, reason });
    poolFitnessStore.set(poolId, scopes);
    return true;
  }),
  deleteProxyPoolFitness: vi.fn(async (poolId, scope) => {
    poolFitnessStore.get(poolId)?.delete(scope);
    return true;
  }),
  clearProxyPoolFitness: vi.fn(async () => {
    poolFitnessStore.clear();
    return true;
  }),
  deleteProxyPoolFitnessByPool: vi.fn(async () => true),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "../../src/lib/network/connectionProxy.js";
import { markPoolUnfit, clearPoolUnfit, clearAllPoolUnfit, isPoolFit, fitPoolIds, loadPoolFitness, resetPoolFitness } from "../../open-sse/services/proxyPoolFitness.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let picked = null;

// ── Loopback harness ────────────────────────────────────────────────────────
function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

/** Minimal forwarding proxy: CONNECT tunnelling + absolute-form GET fallback. */
async function startProxy() {
  const stats = { hits: 0, tunnelled: 0, connectTargets: [] };
  const server = http.createServer((req, res) => {
    stats.hits += 1;
    let target;
    try { target = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
    const upstream = http.request(
      { host: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: req.method, headers: req.headers },
      (upstreamRes) => { res.writeHead(upstreamRes.statusCode, upstreamRes.headers); upstreamRes.pipe(res); },
    );
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  server.on("connect", (req, clientSocket, head) => {
    stats.hits += 1;
    stats.tunnelled += 1;
    const [host, port] = req.url.split(":");
    stats.connectTargets.push(`${host}:${port}`);
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  const port = await listen(server);
  return { server, port, stats, url: `http://127.0.0.1:${port}` };
}

async function startOrigin() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, marker: req.headers["x-test-marker"] || null });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  const port = await listen(server);
  return { server, port, seen, url: `http://127.0.0.1:${port}` };
}

// Undici may silently retry a request on a stale keep-alive connection, so
// counts are not stable across tests. Tag every request with a unique marker
// and assert on that instead.
let markerSeq = 0;
const nextMarker = () => `marker-${Date.now()}-${++markerSeq}`;
const originHitsFor = (marker) => origin.seen.filter((entry) => entry.marker === marker);

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let origin;
let proxy;
const ENV_PROXY_KEYS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
let savedEnv = {};

beforeAll(async () => {
  origin = await startOrigin();
  proxy = await startProxy();
});

afterAll(async () => {
  await new Promise((resolve) => origin.server.close(resolve));
  await new Promise((resolve) => proxy.server.close(resolve));
});

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_PROXY_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
});

describe("proxy pool → trafik benar-benar lewat proxy", () => {
  it("merutekan request melalui connectionProxyUrl dan menandai origin", async () => {
    const before = proxy.stats.hits;
    const marker = nextMarker();
    const res = await proxyAwareFetch(
      `${origin.url}/ping`,
      { headers: { "x-test-marker": marker } },
      { connectionProxyEnabled: true, connectionProxyUrl: proxy.url },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, path: "/ping" });
    expect(proxy.stats.hits).toBeGreaterThan(before);
    expect(proxy.stats.connectTargets.some((t) => t === `127.0.0.1:${origin.port}`)).toBe(true);
    expect(originHitsFor(marker).length).toBeGreaterThanOrEqual(1);
  });

  it("menghormati connectionNoProxy dan lewat langsung", async () => {
    const before = proxy.stats.hits;
    const marker = nextMarker();
    const res = await proxyAwareFetch(
      `${origin.url}/direct`,
      { headers: { "x-test-marker": marker } },
      { connectionProxyEnabled: true, connectionProxyUrl: proxy.url, connectionNoProxy: "127.0.0.1" },
    );

    expect(res.status).toBe(200);
    expect(proxy.stats.hits).toBe(before);
    expect(originHitsFor(marker).length).toBeGreaterThanOrEqual(1);
  });

  it("strictProxy=true gagal keras saat proxy mati (tidak diam-diam direct)", async () => {
    const deadPort = await freePort();
    await expect(
      proxyAwareFetch(`${origin.url}/strict`, {}, {
        connectionProxyEnabled: true,
        connectionProxyUrl: `http://127.0.0.1:${deadPort}`,
        strictProxy: true,
      }),
    ).rejects.toThrow(/strictProxy/i);
  });

  it("tanpa strictProxy, proxy mati jatuh ke direct (perilaku saat ini)", async () => {
    const deadPort = await freePort();
    const marker = nextMarker();
    const res = await proxyAwareFetch(`${origin.url}/fallback`, { headers: { "x-test-marker": marker } }, {
      connectionProxyEnabled: true,
      connectionProxyUrl: `http://127.0.0.1:${deadPort}`,
      strictProxy: false,
    });

    expect(res.status).toBe(200);
    expect(originHitsFor(marker).length).toBeGreaterThanOrEqual(1);
  });
});

describe("resolveConnectionProxyConfig", () => {
  it("pool standar aktif → connectionProxyEnabled + url + poolId", async () => {
    poolStore.set("pool-std", { id: "pool-std", name: "std", isActive: true, proxyUrl: proxy.url, type: "standard", strictProxy: true });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "pool-std" });

    expect(cfg.source).toBe("pool");
    expect(cfg.proxyPoolId).toBe("pool-std");
    expect(cfg.connectionProxyEnabled).toBe(true);
    expect(cfg.connectionProxyUrl).toBe(proxy.url);
    expect(cfg.strictProxy).toBe(true);
  });

  it("pool tipe vercel/cloudflare/deno → vercelRelayUrl, bukan connectionProxyUrl", async () => {
    poolStore.set("pool-relay", { id: "pool-relay", name: "relay", isActive: true, proxyUrl: "https://relay.example.workers.dev", type: "vercel" });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "pool-relay" });

    expect(cfg.source).toBe("vercel");
    expect(cfg.vercelRelayUrl).toBe("https://relay.example.workers.dev");
    expect(cfg.connectionProxyEnabled).toBe(false);
  });

  it("pool tidak ada / tidak aktif → fallback ke legacy lalu none", async () => {
    poolStore.set("pool-dead", { id: "pool-dead", name: "dead", isActive: false, proxyUrl: proxy.url });

    const withLegacy = await resolveConnectionProxyConfig({
      proxyPoolId: "pool-dead",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://legacy.example:8080",
    });
    expect(withLegacy.source).toBe("legacy");
    expect(withLegacy.connectionProxyUrl).toBe("http://legacy.example:8080");

    const none = await resolveConnectionProxyConfig({ proxyPoolId: "pool-dead" });
    expect(none.source).toBe("none");
    expect(none.connectionProxyEnabled).toBe(false);
  });

  it('"__none__" mematikan pool secara eksplisit', async () => {
    poolStore.set("pool-std", { id: "pool-std", name: "std", isActive: true, proxyUrl: proxy.url, type: "standard" });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "__none__" });

    expect(cfg.source).toBe("none");
    expect(cfg.connectionProxyEnabled).toBe(false);
  });
});

describe("pickProxyPoolId", () => {
  it("rotasi round-robin memutar semua pool", () => {
    const ids = ["a", "b", "c"];
    const seen = [0, 1, 2, 3].map(() => pickProxyPoolId(ids, "round-robin", "test-rr"));
    expect(seen.slice(0, 3).sort()).toEqual(["a", "b", "c"]);
    expect(seen[3]).toBe(seen[0]);
  });

  it("pool tunggal selalu dikembalikan, daftar kosong → null", () => {
    expect(pickProxyPoolId(["only"], "round-robin", "x")).toBe("only");
    expect(pickProxyPoolId([], "round-robin", "x")).toBe(null);
    expect(pickProxyPoolId(null, "random", "x")).toBe(null);
  });

  it("strategi none/unknown memakai entri pertama", () => {
    expect(pickProxyPoolId(["a", "b"], "none", "x")).toBe("a");
  });
});

describe("integrasi registry fitness dengan pemilih pool", () => {
  beforeEach(async () => {
    await resetPoolFitness();
  });

  it("markPoolUnfit menandai pool tidak fit untuk scope provider::model", async () => {
    await markPoolUnfit("pool-a", "freebuff::deepseek/deepseek-v4-flash", Date.now() + 60_000, "limited_ip");

    expect(isPoolFit("pool-a", "freebuff::deepseek/deepseek-v4-flash")).toBe(false);
    expect(isPoolFit("pool-b", "freebuff::deepseek/deepseek-v4-flash")).toBe(true);
    expect(fitPoolIds(["pool-a", "pool-b"], "freebuff::deepseek/deepseek-v4-flash")).toEqual(["pool-b"]);
  });

  it("wildcard provider::* juga dihormati", async () => {
    await markPoolUnfit("pool-a", "freebuff::*", Date.now() + 60_000, "limited_ip");
    expect(isPoolFit("pool-a", "freebuff::model-lain")).toBe(false);
  });

  it("clearPoolUnfit memulihkan pool", async () => {
    await markPoolUnfit("pool-a", "freebuff::m", Date.now() + 60_000, "limited_ip");
    await clearPoolUnfit("pool-a", "freebuff::m");
    expect(isPoolFit("pool-a", "freebuff::m")).toBe(true);
  });

  it("rotasi melewati pool yang cooling down (kontrak auth.js)", async () => {
    const scope = "freebuff::deepseek/deepseek-v4-flash";
    await markPoolUnfit("pool-a", scope, Date.now() + 60_000, "limited_ip");
    const poolIds = ["pool-a", "pool-b"];

    // Inilah urutan yang dipakai getProviderCredentials() untuk rotasi pool.
    await Promise.all(poolIds.map((id) => loadPoolFitness(id)));
    const fitIds = fitPoolIds(poolIds, scope);
    picked = pickProxyPoolId(fitIds.length ? fitIds : poolIds, "round-robin", "freebuff");

    expect(fitIds).toEqual(["pool-b"]);
    expect(picked).toBe("pool-b");
  });

  it("jika SEMUA pool cooling down, satu tetap dipilih (fail-open)", async () => {
    const scope = "freebuff::m";
    await markPoolUnfit("pool-a", scope, Date.now() + 60_000, "limited_ip");
    const poolIds = ["pool-a"];

    await Promise.all(poolIds.map((id) => loadPoolFitness(id)));
    const fitIds = fitPoolIds(poolIds, scope);

    expect(fitIds).toEqual([]);
    expect(pickProxyPoolId(fitIds.length ? fitIds : poolIds, "round-robin", "freebuff")).toBe("pool-a");
  });

  it("entri kedaluwarsa diabaikan tanpa perlu dibersihkan manual", async () => {
    await markPoolUnfit("pool-a", "freebuff::m", Date.now() - 1, "limited_ip");
    expect(isPoolFit("pool-a", "freebuff::m")).toBe(true);
    expect(fitPoolIds(["pool-a"], "freebuff::m")).toEqual(["pool-a"]);
  });

  it("clearAllPoolUnfit hanya membersihkan scope provider yang diminta", async () => {
    await markPoolUnfit("pool-a", "freebuff::m", Date.now() + 60_000, "limited_ip");
    await markPoolUnfit("pool-a", "opencode::m", Date.now() + 60_000, "limited_ip");

    await clearAllPoolUnfit("freebuff");
    expect(isPoolFit("pool-a", "freebuff::m")).toBe(true);
    expect(isPoolFit("pool-a", "opencode::m")).toBe(false);
  });

  it("guard: chatCore membawa proxyPoolId dan retry pool-scoped", () => {
    const src = readFileSync(fileURLToPath(new URL("../../open-sse/handlers/chatCore.js", import.meta.url)), "utf8");
    const at = src.indexOf("proxyOptions = {");
    expect(at).toBeGreaterThan(-1);

    const block = src.slice(at, at + 700);
    expect(block).toContain("proxyPoolId");
    expect(block).toContain("connectionProxyPoolId");

    // Retry lintas-pool: penanda poolScoped harus dikonsumsi, bukan diabaikan.
    expect(src).toContain("executeWithPoolFallback");
    expect(src).toContain("error?.poolScoped");
    expect(src).toContain("markPoolUnfit(");
    expect(src).toContain("repickProxyPool");
  });

  it("guard: freebuff hanya dipaksa lewat proxy kalau ada pool terikat", () => {
    const src = readFileSync(fileURLToPath(new URL("../../open-sse/handlers/chatCore.js", import.meta.url)), "utf8");
    const start = src.indexOf('provider === "freebuff" &&');
    expect(start).toBeGreaterThan(-1);

    const guard = src.slice(start - 600, start + 400);
    // Guard harus bergantung pada proxyPoolId (pool terikat) ...
    expect(guard).toContain("proxyOptions.proxyPoolId");
    // ... dan menolak hanya kalau tidak ada proxy yang benar-benar terpakai.
    expect(guard).toContain("!proxyOptions.connectionProxyUrl");
    expect(guard).toContain("!proxyOptions.vercelRelayUrl");
    expect(guard).toContain("refusing to fall back to direct egress");
    // Tanpa pool terikat, guard tidak boleh aktif.
    expect(guard).not.toContain('provider === "freebuff" && !proxyOptions');
  });
});
