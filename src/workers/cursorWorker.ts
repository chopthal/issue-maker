import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "../config.js";

export async function runCursor(prompt: string, model?: string, mode?: string): Promise<string> {
  const tempFile = path.join(os.tmpdir(), `issue_maker_cursor_${Date.now()}.txt`);
  fs.writeFileSync(tempFile, prompt, "utf-8");

  return new Promise((resolve, reject) => {
    const targetModel = model || config.worker.model || "auto";
    const targetMode = mode || config.worker.mode || "plan";

    const args = [
      "-p",
      "--trust",
      "--output-format",
      "text",
      "--mode",
      targetMode,
    ];

    if (targetModel && targetModel !== "auto") {
      args.push("--model", targetModel);
    }

    args.push(`다음 파일의 내용을 바탕으로 완성형 GitHub Issue를 작성해줘: ${tempFile}`);

    const child = spawn("cursor-agent", args, {
      shell: true,
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
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {}

      const output = stdout.trim();
      if (code === 0 && output.length > 0) {
        resolve(output);
      } else {
        const err = `Cursor execution failed with code ${code}. Stderr: ${stderr.trim()}`;
        console.error(err);
        if (output.length > 0) {
          resolve(output);
        } else {
          reject(new Error(err));
        }
      }
    });

    child.on("error", (error) => {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {}
      reject(error);
    });
  });
}
