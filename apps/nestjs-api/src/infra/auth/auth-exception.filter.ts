import { ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { AuthError } from "./error-codes";

/** JSON auth endpoints reproduce Django's auth_exception_handler: {error_code, error_message, ...payload}. */
@Catch(AuthError)
export class AuthJsonExceptionFilter implements ExceptionFilter {
  catch(err: AuthError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(err.status).json(err.getErrorDict());
  }
}
