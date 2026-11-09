import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function getAgyExecutablePath(): string {
  const localAgy = path.join(os.homedir(), "AppData", "Local", "agy", "bin", "agy.exe");
  if (fs.existsSync(localAgy)) {
    return localAgy;
  }
  return "agy.exe";
}

export async function runAgy(
  prompt: string,
  model = "gemini-3.8-flash-low",
  mode: "plan" | "auto" = "plan",
  effort: "low" | "medium" | "high" | "xhigh" | "max" = "low"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const agyBin = getAgyExecutablePath();

    // shell: false 로 실행하여 인자 내 공백/따옴표 쪼개짐 원천 방지
    const args = [
      `--model=${model}`,
      `--mode=${mode}`,
      `--effort=${effort}`,
      "--dangerously-skip-permissions",
      "-p",
      prompt,
    ];

    const child = spawn(agyBin, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const output = stdout.trim();
      if (code === 0 && output.length > 0) {
        resolve(output);
      } else {
        const err = `agy execution failed with code ${code}. Stderr: ${stderr.trim()}`;
        console.error(err);
        if (output.length > 0) {
          resolve(output);
        } else {
          reject(new Error(err));
        }
      }
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
}
