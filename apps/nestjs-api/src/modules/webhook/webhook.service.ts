import { randomBytes } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { isBlockedUrl } from "../../shared/url-guard";
import type { CreateWebhookDto, UpdateWebhookDto } from "./dto/webhook.dto";
import { WebhookRepository } from "./webhook.repository";
import { serializeWebhook, type WebhookDTO } from "./webhook.serializer";

const generateToken = (): string => randomBytes(32).toString("hex");

@Injectable()
export class WebhookService {
  constructor(private readonly repo: WebhookRepository) {}

  private async workspaceId(slug: string): Promise<string> {
    const id = await this.repo.workspaceIdBySlug(slug);
    if (!id) throw new NotFoundException("The required object does not exist.");
    return id;
  }

  async list(slug: string): Promise<WebhookDTO[]> {
    const rows = await this.repo.listByWorkspace(await this.workspaceId(slug));
    return rows.map(serializeWebhook);
  }

  async retrieve(slug: string, id: string): Promise<WebhookDTO> {
    const wh = await this.repo.findInWorkspace(await this.workspaceId(slug), id);
    if (!wh) throw new NotFoundException("The required object does not exist.");
    return serializeWebhook(wh);
  }

  async create(slug: string, dto: CreateWebhookDto): Promise<WebhookDTO> {
    if (isBlockedUrl(dto.url)) throw new BadRequestException({ error: "URL is not allowed" });
    const wh = await this.repo.create({
      workspaceId: await this.workspaceId(slug),
      url: dto.url,
      secretKey: generateToken(),
      isActive: dto.is_active ?? true,
      project: dto.project ?? false,
      issue: dto.issue ?? false,
      module: dto.module ?? false,
      cycle: dto.cycle ?? false,
      issueComment: dto.issue_comment ?? false,
    });
    return serializeWebhook(wh);
  }

  async update(slug: string, id: string, dto: UpdateWebhookDto): Promise<WebhookDTO> {
    const wsId = await this.workspaceId(slug);
    const existing = await this.repo.findInWorkspace(wsId, id);
    if (!existing) throw new NotFoundException("The required object does not exist.");
    if (dto.url && isBlockedUrl(dto.url)) throw new BadRequestException({ error: "URL is not allowed" });
    const updated = await this.repo.update(id, {
      ...(dto.url !== undefined ? { url: dto.url } : {}),
      ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      ...(dto.project !== undefined ? { project: dto.project } : {}),
      ...(dto.issue !== undefined ? { issue: dto.issue } : {}),
      ...(dto.module !== undefined ? { module: dto.module } : {}),
      ...(dto.cycle !== undefined ? { cycle: dto.cycle } : {}),
      ...(dto.issue_comment !== undefined ? { issueComment: dto.issue_comment } : {}),
    });
    return serializeWebhook(updated!);
  }

  async regenerate(slug: string, id: string): Promise<WebhookDTO> {
    const wsId = await this.workspaceId(slug);
    const existing = await this.repo.findInWorkspace(wsId, id);
    if (!existing) throw new NotFoundException("The required object does not exist.");
    const updated = await this.repo.update(id, { secretKey: generateToken() });
    return serializeWebhook(updated!);
  }

  async destroy(slug: string, id: string): Promise<void> {
    const wsId = await this.workspaceId(slug);
    const existing = await this.repo.findInWorkspace(wsId, id);
    if (!existing) throw new NotFoundException("The required object does not exist.");
    await this.repo.softDelete(id);
  }
}
