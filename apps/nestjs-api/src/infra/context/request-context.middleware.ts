import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { RequestContextService } from "./request-context";

// Establishes the AsyncLocalStorage store for the whole request so guards/interceptors/repositories
// downstream of next() share it. Auth guards/interceptor then populate userId.
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly ctx: RequestContextService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.ctx.run({ userId: null }, () => next());
  }
}
