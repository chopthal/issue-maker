/** 텔레그램 /restart 시 사용. 트레이 런처가 이 코드로 종료되면 자동 재기동한다. */
export const RESTART_EXIT_CODE = 42;

export const appStartedAt = Date.now();

export function formatUptime(ms: number = Date.now() - appStartedAt): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}
