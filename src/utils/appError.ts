export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  expose: boolean;

  constructor(params: {
    message: string;
    statusCode: number;
    code: string;
    details?: unknown;
    expose?: boolean;
  }) {
    super(params.message);
    this.name = "AppError";
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.details = params.details;
    this.expose = params.expose ?? true;
  }
}
