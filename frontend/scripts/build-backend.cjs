const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const backendDir = path.join(repoRoot, "backend");
const venvPython = path.join(backendDir, ".venv", "Scripts", "python.exe");
const python = fs.existsSync(venvPython) ? venvPython : "python";

const result = spawnSync(python, ["-m", "PyInstaller", "--noconfirm", "--clean", "backend.spec"], {
  cwd: backendDir,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
