import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { JobCancelledError } from "../runtime/jobManager.js";

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
  imagePaths: string[] = [],
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new JobCancelledError();
  }

  return new Promise((resolve, reject) => {
    const agyBin = getAgyExecutablePath();

    // shell: false 로 실행하여 인자 내 공백/따옴표 쪼개짐 원천 방지
    // effort는 모델명 접미사에 포함되므로 --effort 플래그는 사용하지 않음
    const args: string[] = [
      `--model=${model}`,
      `--mode=${mode}`,
      "--dangerously-skip-permissions",
    ];

    const uniqueDirs = [...new Set(imagePaths.map((p) => path.dirname(p)))];
    for (const dir of uniqueDirs) {
      args.push("--add-dir", dir);
    }

    args.push("-p", prompt);

    const child: ChildProcessWithoutNullStreams = spawn(agyBin, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    }) as ChildProcessWithoutNullStreams;

    let stdout = "";
    let stderr = "";
    let settled = false;

    const onAbort = () => {
      try {
        child.kill();
      } catch {}
      if (!settled) {
        settled = true;
        reject(new JobCancelledError());
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      if (settled) return;

      if (signal?.aborted) {
        settled = true;
        reject(new JobCancelledError());
        return;
      }

      const output = stdout.trim();
      if (code === 0 && output.length > 0) {
        settled = true;
        resolve(output);
      } else {
        const err = `agy execution failed with code ${code}. Stderr: ${stderr.trim()}`;
        console.error(err);
        if (output.length > 0) {
          settled = true;
          resolve(output);
        } else {
          settled = true;
          reject(new Error(err));
        }
      }
    });

    child.on("error", (error) => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}
