import { Octokit } from "@octokit/rest";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface GitHubIssueResult {
  success: boolean;
  issueNumber?: number;
  issueUrl?: string;
  errorMessage?: string;
  localSavedPath?: string;
}

export async function createGitHubIssue(
  title: string,
  body: string,
  labels: string[] = ["spec", "telegram-sync"]
): Promise<GitHubIssueResult> {
  const { token, owner, repo } = config.github;

  if (!token || !owner || !repo) {
    // 설정이 없을 때 로컬 파일로 저장 (오프라인/테스트 모드)
    const backupDir = path.join(config.storage.dataDir, "generated_issues");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const safeTitle = title.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").slice(0, 50);
    const filename = `${Date.now()}_${safeTitle}.md`;
    const fullPath = path.join(backupDir, filename);

    fs.writeFileSync(fullPath, `# ${title}\n\n${body}`, "utf-8");

    return {
      success: false,
      errorMessage: "GitHub 토큰 또는 Owner/Repo 설정이 .env에 없습니다. 이슈를 로컬 마크다운 파일로 저장했습니다.",
      localSavedPath: fullPath,
    };
  }

  try {
    const octokit = new Octokit({ auth: token });
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
    });

    return {
      success: true,
      issueNumber: response.data.number,
      issueUrl: response.data.html_url,
    };
  } catch (err: any) {
    console.error("GitHub issue creation failed:", err);
    return {
      success: false,
      errorMessage: err.message || "알 수 없는 GitHub API 오류",
    };
  }
}
