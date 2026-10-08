export type CoreErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" |
  "IDEMPOTENCY_CONFLICT" | "UNAUTHENTICATED" | "DEPENDENCY";

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  constructor(code: CoreErrorCode, message: string) {
    super(message);
    this.name = "CoreError";
    this.code = code;
  }
}

export function invalid(message: string): never {
  throw new CoreError("INVALID_INPUT", message);
}
