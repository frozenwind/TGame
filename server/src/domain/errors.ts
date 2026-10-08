import type { ErrorCode } from "../../../shared/protocol.js";

export class GameError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

export function isGameError(error: unknown): error is GameError {
  return error instanceof GameError;
}
