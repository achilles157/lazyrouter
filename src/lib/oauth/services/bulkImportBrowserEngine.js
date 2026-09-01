import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function resolveRuntimeModuleDir(metaUrl = import.meta.url) {
  try {
    return path.dirname(fileURLToPath(metaUrl));
  } catch {
    return process.cwd();
  }
}

const currentDir = resolveRuntimeModuleDir();
const importRuntimeModule = Function("specifier", "return import(specifier)");

const SUPPORTED_ENGINES = new Set(["chromium", "camoufox", "chrome"]);
export const DEFAULT_BULK_IMPORT_ENGINE = "chromium";

export function normalizeBulkImportEngine(value) {
  if (typeof value !== "string") return DEFAULT_BULK_IMPORT_ENGINE;
  const lower = value.trim().toLowerCase();
  return SUPPORTED_ENGINES.has(lower) ? lower : DEFAULT_BULK_IMPORT_ENGINE;
}

export function buildBrowserProxyOption(proxyUrl) {
  const clean = String(proxyUrl || "").trim();
  if (!clean) return null;
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return { server: clean };
  }
  const server = `${parsed.protocol}//${parsed.host}`;
  const proxy = { server };
  if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
  if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
  return proxy;
}

async function tryLoadRuntimeHelper(filePath) {
  try {
    const mod = await importRuntimeModule(pathToFileURL(filePath).href);
    return mod?.default || mod;
  } catch {
    return null;
  }
}

async function loadRuntimeHelperFromRoot(rootDir, name) {
  if (!rootDir) return null;
  let dir = path.resolve(rootDir);
  for (let depth = 0; depth < 10; depth += 1) {
    for (const relativeFile of [`cli/hooks/${name}.js`, `hooks/${name}.js`]) {
      const candidate = path.join(dir, relativeFile);
      if (!fs.existsSync(candidate)) continue;
      const helper = await tryLoadRuntimeHelper(candidate);
      if (helper) return helper;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadRuntimeHelper(name) {
  const directSpecs = [
    `../../../../cli/hooks/${name}`,
    `../../../../../hooks/${name}`,
    `../../../../hooks/${name}`,
  ];

  for (const spec of directSpecs) {
    const filePath = path.resolve(currentDir, `${spec}.js`);
    if (!fs.existsSync(filePath)) continue;
    const helper = await tryLoadRuntimeHelper(filePath);
    if (helper) return helper;
  }

  const roots = [
    currentDir,
    process.cwd(),
    process.argv?.[1] ? path.dirname(process.argv[1]) : "",
  ];
  for (const root of roots) {
    const helper = await loadRuntimeHelperFromRoot(root, name);
    if (helper) return helper;
  }

  return null;
}

function loadRuntimePlaywright(runtime) {
  try {
    return runtime?.loadPlaywrightModule?.() || null;
  } catch {
    return null;
  }
}

function loadRuntimeCamoufox(runtime) {
  try {
    return runtime?.loadCamoufoxModule?.() || null;
  } catch {
    return null;
  }
}

async function launchRealChrome({ proxyUrl, headless = false, args = [] } = {}) {
  // Launch system Chrome with remote debugging, connect Playwright via CDP.
  // Real Chrome has a legitimate browser fingerprint that bypasses Google's
  // "this browser may not be secure" block that affects Playwright Chromium.
  const { spawn } = await import("child_process");
  const { createConnection } = await import("net");
  const os = await import("os");
  const path = await import("path");
  const fs = await import("fs");

  const CHROME_CANDIDATES = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe") : "",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  const chromeBin = CHROME_CANDIDATES.find((c) => c && fs.existsSync(c));
  if (!chromeBin) {
    const err = new Error("Chrome (Real) engine: cannot find Chrome binary. Install Google Chrome or use Chromium/Camoufox instead.");
    err.code = "CHROME_NOT_FOUND";
    throw err;
  }

  const port = 19200 + Math.floor(Math.random() * 400);
  const tmpDir = path.join(os.tmpdir(), `9r_chrome_${port}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-translate",
    "--disable-infobars",
    "--no-sandbox",
    ...args,
  ];

  if (headless) chromeArgs.push("--headless=new");
  if (proxyUrl) chromeArgs.push(`--proxy-server=${proxyUrl}`);

  const proc = spawn(chromeBin, chromeArgs, { stdio: "ignore", detached: false });

  // Wait for debugging port to open (up to 10s)
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const tryConnect = () => {
      const sock = createConnection(port, "127.0.0.1");
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`Chrome did not open debugging port ${port} in time`));
        else setTimeout(tryConnect, 300);
      });
    };
    tryConnect();
  });

  // Load Playwright and connect via CDP
  const runtime = await loadRuntimeHelper("playwrightRuntime");
  const runtimePlaywright = loadRuntimePlaywright(runtime);
  if (!runtimePlaywright?.chromium) {
    proc.kill();
    const err = new Error("Playwright not available for CDP connection. Reinstall wyxrouter.");
    err.code = "PLAYWRIGHT_PACKAGE_MISSING";
    throw err;
  }

  const browser = await runtimePlaywright.chromium.connectOverCDP(`http://127.0.0.1:${port}`);

  // Kill Chrome when Playwright disconnects
  browser.on("disconnected", () => {
    try { proc.kill(); } catch {}
  });

  return browser;
}

async function launchChromium({ proxyUrl, headless = true, args = [] } = {}) {
  let chromium;
  const runtime = await loadRuntimeHelper("playwrightRuntime");
  if (runtime?.ensurePlaywrightRuntime) {
    const ensured = runtime.ensurePlaywrightRuntime({ silent: false });
    if (!ensured?.ok) {
      const err = ensured?.error || new Error("Playwright automation runtime is not available.");
      err.code = err.code || "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
  }
  const existingRuntimePlaywright = loadRuntimePlaywright(runtime);
  if (existingRuntimePlaywright?.chromium) {
    chromium = existingRuntimePlaywright.chromium;
  } else {
    if (!runtime?.installPlaywrightOnly) {
      const err = new Error(
        "Playwright not installed and runtime helper unavailable. Reinstall wyxrouter, then retry."
      );
      err.code = "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
    const installed = runtime.installPlaywrightOnly({ silent: false });
    if (!installed.ok) {
      const err = new Error(
        `Playwright auto-install failed: ${installed.reason}. Run "wyxrouter doctor" or reinstall wyxrouter, then retry.`
      );
      err.code = "PLAYWRIGHT_INSTALL_FAILED";
      throw err;
    }
    const installedRuntimePlaywright = loadRuntimePlaywright(runtime);
    if (!installedRuntimePlaywright?.chromium) {
      const err = new Error(
        "Playwright installed into the 9router automation runtime, but Node could not load it. Restart wyxrouter and retry."
      );
      err.code = "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
    chromium = installedRuntimePlaywright.chromium;
  }
  const options = { headless };
  if (args.length) options.args = args;
  const proxy = buildBrowserProxyOption(proxyUrl);
  if (proxy) options.proxy = proxy;
  return chromium.launch(options);
}

async function loadFirefoxForCamoufox() {
  const runtime = await loadRuntimeHelper("playwrightRuntime");
  if (runtime?.ensurePlaywrightRuntime) {
    const ensured = runtime.ensurePlaywrightRuntime({ silent: false });
    if (!ensured?.ok) {
      const err = ensured?.error || new Error("Playwright automation runtime is not available.");
      err.code = err.code || "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
  }
  const runtimePlaywright = loadRuntimePlaywright(runtime);
  if (runtimePlaywright?.firefox) return runtimePlaywright.firefox;
  if (runtime?.installPlaywrightOnly) {
    const installed = runtime.installPlaywrightOnly({ silent: false });
    if (installed.ok) {
      const installedRuntimePlaywright = loadRuntimePlaywright(runtime);
      if (installedRuntimePlaywright?.firefox) return installedRuntimePlaywright.firefox;
    }
  }
  const friendly = new Error(
    "Playwright is required to drive Camoufox. Reinstall wyxrouter or pick the Chromium engine."
  );
  friendly.code = "PLAYWRIGHT_PACKAGE_MISSING";
  throw friendly;
}

async function launchCamoufox({ proxyUrl, headless = true, args = [] } = {}) {
  let camoufox;
  const runtime = await loadRuntimeHelper("camoufoxRuntime");
  if (runtime?.ensureCamoufoxRuntime) {
    const ensured = runtime.ensureCamoufoxRuntime({ silent: false });
    if (!ensured?.ok) {
      const err = ensured?.error || new Error("Camoufox automation runtime is not available.");
      err.code = err.code || "CAMOUFOX_PACKAGE_MISSING";
      throw err;
    }
  }
  camoufox = loadRuntimeCamoufox(runtime);
  if (!camoufox) {
    if (!runtime?.installCamoufoxOnly) {
      const err = new Error(
        "Camoufox not installed and runtime helper unavailable. Reinstall wyxrouter or pick the Chromium engine."
      );
      err.code = "CAMOUFOX_PACKAGE_MISSING";
      throw err;
    }
    const installed = runtime.installCamoufoxOnly({ silent: false });
    if (!installed.ok) {
      const err = new Error(
        `Camoufox auto-install failed: ${installed.reason}. Restart 9router and retry, or switch back to the Chromium engine.`
      );
      err.code = "CAMOUFOX_INSTALL_FAILED";
      throw err;
    }
    camoufox = loadRuntimeCamoufox(runtime);
  }

  if (!camoufox?.launchOptions) {
    const err = new Error(
      `camoufox-js loaded but does not expose launchOptions(); reinstall the package or pick the Chromium engine.`
    );
    err.code = "CAMOUFOX_API_MISMATCH";
    throw err;
  }

  const firefox = await loadFirefoxForCamoufox();

  const camoufoxOptions = await camoufox.launchOptions({ headless });
  const launchOptions = { ...camoufoxOptions };
  if (args.length) launchOptions.args = [...(launchOptions.args || []), ...args];
  const proxy = buildBrowserProxyOption(proxyUrl);
  if (proxy) launchOptions.proxy = proxy;

  return firefox.launch(launchOptions);
}

export async function launchBulkImportBrowser({ engine = DEFAULT_BULK_IMPORT_ENGINE, proxyUrl, headless = true, args = [] } = {}) {
  const normalized = normalizeBulkImportEngine(engine);
  if (normalized === "camoufox") {
    return launchCamoufox({ proxyUrl, headless, args });
  }
  if (normalized === "chrome") {
    // Real Chrome always runs non-headless to avoid Google security block
    return launchRealChrome({ proxyUrl, headless: false, args });
  }
  return launchChromium({ proxyUrl, headless, args });
}

export function makeBrowserLauncher({ engine, proxyUrl, headless, args } = {}) {
  return () => launchBulkImportBrowser({ engine, proxyUrl, headless, args });
}
