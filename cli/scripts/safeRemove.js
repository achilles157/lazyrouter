const fs = require("fs");
const path = require("path");

const WINDOWS_LOCK_ERROR_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

function waitSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function makeWritable(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  fs.chmodSync(target, stat.mode | 0o200);
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(target)) {
    makeWritable(path.join(target, entry));
  }
}

function removePathWithRetries(target, { attempts = 5, delayMs = 250 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (!fs.existsSync(target)) return true;
      makeWritable(target);
      fs.rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: delayMs,
      });
      return !fs.existsSync(target);
    } catch (error) {
      if (!WINDOWS_LOCK_ERROR_CODES.has(error.code) || attempt === attempts) {
        throw error;
      }
      waitSync(delayMs * attempt);
    }
  }
  return !fs.existsSync(target);
}

function moveLockedPathAside(target, { staleDir, label = "path" }) {
  fs.mkdirSync(staleDir, { recursive: true });
  const baseName = path.basename(target);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const movedPath = path.join(staleDir, `${baseName}-${stamp}-${process.pid}`);
  fs.renameSync(target, movedPath);
  try {
    removePathWithRetries(movedPath, { attempts: 2, delayMs: 200 });
  } catch (error) {
    console.warn(`⚠️  ${label} was moved aside but is still locked: ${movedPath}`);
    console.warn("   It will not block this build. Close the old process and delete it later.");
    console.warn(`   Last cleanup error: ${error.code || error.name}: ${error.message}`);
  }
  return movedPath;
}

function cleanPathForRebuild(target, { staleDir, label = "path", processHint = "" } = {}) {
  if (!fs.existsSync(target)) return { action: "missing" };
  try {
    removePathWithRetries(target);
    return { action: "removed" };
  } catch (error) {
    if (!WINDOWS_LOCK_ERROR_CODES.has(error.code)) throw error;
    console.warn(`⚠️  ${target} is locked (${error.code}). Moving it aside and continuing...`);
    try {
      const movedPath = moveLockedPathAside(target, { staleDir, label });
      return { action: "moved", movedPath };
    } catch (moveError) {
      const details = [
        `❌ Cannot clean ${target}. Windows is still holding a lock.`,
        processHint ? `   ${processHint}` : "",
        `   Cleanup error: ${error.code || error.name}: ${error.message}`,
        `   Move-aside error: ${moveError.code || moveError.name}: ${moveError.message}`,
      ].filter(Boolean);
      throw new Error(details.join("\n"));
    }
  }
}

module.exports = {
  WINDOWS_LOCK_ERROR_CODES,
  cleanPathForRebuild,
  makeWritable,
  moveLockedPathAside,
  removePathWithRetries,
};
