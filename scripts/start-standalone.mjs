import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(projectRoot, ".next", "standalone");

function ensureLinkedDir(source, destination) {
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;

  fs.mkdirSync(path.dirname(destination), { recursive: true });

  try {
    fs.symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
  } catch {
    fs.cpSync(source, destination, { recursive: true });
  }
}

ensureLinkedDir(path.join(projectRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"));
ensureLinkedDir(path.join(projectRoot, "public"), path.join(standaloneRoot, "public"));

require(path.join(standaloneRoot, "server.js"));
