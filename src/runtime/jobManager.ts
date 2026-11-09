/**
 * 채팅방별 진행 중 작업(요약/프리뷰) 추적 및 취소.
 * AbortSignal로 AGY 자식 프로세스까지 중단한다.
 */
export class JobManager {
  private jobs = new Map<number, AbortController>();

  /** 새 작업 시작. 같은 방에 이전 작업이 있으면 먼저 취소한다. */
  public start(chatId: number): AbortController {
    this.cancel(chatId);
    const controller = new AbortController();
    this.jobs.set(chatId, controller);
    return controller;
  }

  public cancel(chatId: number): boolean {
    const controller = this.jobs.get(chatId);
    if (!controller) return false;
    controller.abort();
    this.jobs.delete(chatId);
    return true;
  }

  public finish(chatId: number, controller: AbortController): void {
    if (this.jobs.get(chatId) === controller) {
      this.jobs.delete(chatId);
    }
  }

  public isActive(chatId: number): boolean {
    return this.jobs.has(chatId);
  }
}

export const jobManager = new JobManager();

export class JobCancelledError extends Error {
  constructor(message = "작업이 취소되었습니다.") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new JobCancelledError();
  }
}
