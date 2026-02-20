import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ext = process.platform === "win32" ? ".exe" : "";

const rustInfo = execSync("rustc -vV");
const targetTriple = /host: (\S+)/g.exec(rustInfo as any)![1];
if (!targetTriple) {
  console.error("Failed to determine platform target triple");
}
fs.mkdirSync(path.join(__dirname, "../../../src-tauri/binaries"), {
  recursive: true,
});
fs.renameSync(
  path.join(__dirname, `../dist/server${ext}`),
  path.join(__dirname, `../../../src-tauri/binaries/server-${targetTriple}${ext}`),
);
