export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler =
  <T extends (req: any, res: any, next: any) => Promise<any>>(handler: T) =>
  (req: any, res: any, next: any) =>
    handler(req, res, next).catch(next);
