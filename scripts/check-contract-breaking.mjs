import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CONTRACT_PATH = "contracts/agent.openapi.yaml";
const OASDIFF_VERSION = "v1.35.0";

const baseRef = process.env.CONTRACT_BASE_REF;

if (!baseRef) {
  console.log("contract:breaking skipped: CONTRACT_BASE_REF is not set");
  process.exit(0);
}

let baseContract;
try {
  baseContract = execFileSync("git", ["show", `${baseRef}:${CONTRACT_PATH}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch {
  console.log(`contract:breaking skipped: ${CONTRACT_PATH} does not exist at ${baseRef}`);
  process.exit(0);
}

const workDir = mkdtempSync(path.join(tmpdir(), "stealth-contract-"));
const baseFile = path.join(workDir, "base.openapi.yaml");
writeFileSync(baseFile, baseContract);

try {
  const result = spawnSync(
    process.platform === "win32" ? "go.exe" : "go",
    [
      "run",
      `github.com/oasdiff/oasdiff@${OASDIFF_VERSION}`,
      "breaking",
      "--fail-on",
      "ERR",
      baseFile,
      CONTRACT_PATH,
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
