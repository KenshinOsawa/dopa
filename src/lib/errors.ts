/** 画面にそのまま出せるメッセージを持つエラー（旧 API の 4xx/5xx 相当）。 */
export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AppError"
  }
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof AppError ? err.message : fallback
}
