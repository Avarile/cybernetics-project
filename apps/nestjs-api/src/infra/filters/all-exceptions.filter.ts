import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Centralised error envelope, reproducing DRF's handle_exception / auth_exception_handler shapes
 * (see developments/backend/current_design/04-api-surface.md §4).
 *
 * HttpExceptions thrown by guards/services already carry the correct body shape ({error}/{detail}/
 * {error_code}) and status, so they pass through. Everything else -> generic 500, matching the
 * Django fallback "Something went wrong please try again later".
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === "object" ? body : { error: body });
      return;
    }

    this.logger.error(
      `Unhandled error on ${req.method} ${req.path}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: "Something went wrong please try again later",
    });
  }
}
