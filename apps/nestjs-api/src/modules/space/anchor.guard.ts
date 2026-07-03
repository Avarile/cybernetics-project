import { CanActivate, createParamDecorator, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { SpaceRepository } from "./space.repository";
import type { DeployBoard } from "./space.schema";

interface AnchoredRequest extends Request {
  anchor?: DeployBoard;
}

/**
 * Resolves the public deploy-board anchor token (no user auth). Anonymous access to published boards
 * is granted purely by possession of a valid, non-disabled anchor (mirrors plane/space).
 */
@Injectable()
export class AnchorGuard implements CanActivate {
  constructor(private readonly repo: SpaceRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AnchoredRequest>();
    const anchor = req.params.anchor;
    if (!anchor) throw new NotFoundException("The required object does not exist.");
    const board = await this.repo.findActiveByAnchor(String(anchor));
    if (!board) throw new NotFoundException("The required object does not exist.");
    req.anchor = board;
    return true;
  }
}

/** Injects the resolved DeployBoard for anchor-scoped public routes. */
export const Anchor = createParamDecorator((_data: unknown, ctx: ExecutionContext): DeployBoard => {
  const req = ctx.switchToHttp().getRequest<AnchoredRequest>();
  return req.anchor as DeployBoard;
});
