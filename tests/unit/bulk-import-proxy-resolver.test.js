import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProxyPoolById: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProxyPoolById: mocks.getProxyPoolById,
}));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: mocks.getSettings,
}));

describe("bulkImportProxyResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports splitBulkImportProxyUrls and parses multiple proxy formats", async () => {
    const { splitBulkImportProxyUrls } = await import(
      "../../src/lib/oauth/services/bulkImportProxyResolver.js"
    );

    expect(typeof splitBulkImportProxyUrls).toBe("function");

    const input = "1.2.3.4:8080:user:pass\nhttp://5.6.7.8:3128";
    const result = splitBulkImportProxyUrls(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("http://user:pass@1.2.3.4:8080/");
    expect(result[1]).toBe("http://5.6.7.8:3128/");
  });

  it("resolves proxy from proxyPoolId using internal splitBulkImportProxyUrls", async () => {
    mocks.getProxyPoolById.mockResolvedValue({
      id: "pool-abc",
      name: "Residential",
      type: "http",
      isActive: true,
      proxyUrl: "http://10.0.0.1:8080\nhttp://10.0.0.2:8080",
    });

    const { resolveBulkImportProxy } = await import(
      "../../src/lib/oauth/services/bulkImportProxyResolver.js"
    );

    const res = await resolveBulkImportProxy({ proxyPoolId: "pool-abc" });
    expect(res.error).toBeNull();
    expect(res.proxySource).toBe("pool");
    expect(res.proxyPoolId).toBe("pool-abc");
    expect(res.proxyUrls).toEqual([
      "http://10.0.0.1:8080/",
      "http://10.0.0.2:8080/",
    ]);
    expect(res.proxyMode).toBe("round-robin");
    expect(res.proxyUrl).toBe("http://10.0.0.1:8080/");
  });

  it("resolves proxy from custom proxyUrl string", async () => {
    const { resolveBulkImportProxy } = await import(
      "../../src/lib/oauth/services/bulkImportProxyResolver.js"
    );

    const res = await resolveBulkImportProxy({
      proxyUrl: "socks5://user:pass@127.0.0.1:1080",
    });
    expect(res.error).toBeNull();
    expect(res.proxySource).toBe("custom");
    expect(res.proxyUrls).toEqual(["socks5://user:pass@127.0.0.1:1080"]);
    expect(res.proxyMode).toBe("single");
  });

  it("falls back to settings outbound proxy when opt-in is enabled", async () => {
    mocks.getSettings.mockResolvedValue({
      useOutboundProxyForAutomation: true,
      outboundProxyUrl: "http://192.168.1.50:8888",
    });

    const { resolveBulkImportProxy } = await import(
      "../../src/lib/oauth/services/bulkImportProxyResolver.js"
    );

    const res = await resolveBulkImportProxy({});
    expect(res.error).toBeNull();
    expect(res.proxySource).toBe("settings");
    expect(res.proxyUrls).toEqual(["http://192.168.1.50:8888/"]);
  });

  it("returns proxyMode none if relay pool type is provided", async () => {
    mocks.getProxyPoolById.mockResolvedValue({
      id: "pool-cf",
      name: "Cloudflare Relay",
      type: "cloudflare",
      isActive: true,
      proxyUrl: "https://worker.dev",
    });

    const { resolveBulkImportProxy } = await import(
      "../../src/lib/oauth/services/bulkImportProxyResolver.js"
    );

    const res = await resolveBulkImportProxy({ proxyPoolId: "pool-cf" });
    expect(res.proxyMode).toBe("none");
    expect(res.error).toContain("cannot be used for browser launch");
  });
});
