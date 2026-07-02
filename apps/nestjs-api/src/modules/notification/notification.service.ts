import { Injectable, NotFoundException } from "@nestjs/common";
import { paginate, type CursorPageParams, type PaginatedResult } from "../../infra/pagination/paginate";
import { NotificationRepository } from "./notification.repository";
import { serializeNotification, type NotificationDTO } from "./notification.serializer";

export interface ListFilters {
  archived?: boolean;
  read?: boolean;
  snoozed?: boolean;
}

@Injectable()
export class NotificationService {
  constructor(private readonly repo: NotificationRepository) {}

  private async workspaceId(slug: string): Promise<string> {
    const id = await this.repo.workspaceIdBySlug(slug);
    if (!id) throw new NotFoundException("The required object does not exist.");
    return id;
  }

  async list(slug: string, receiverId: string, filters: ListFilters, page: CursorPageParams): Promise<PaginatedResult<NotificationDTO>> {
    const workspaceId = await this.workspaceId(slug);
    return paginate<NotificationDTO>(
      page,
      // count omitted for perf parity with Django's cursor pager; total tracks the page window
      async () => (await this.repo.listForReceiver(receiverId, workspaceId, filters, 0, 1_000_000)).length,
      async ({ offset, limitPlusOne }) => {
        const rows = await this.repo.listForReceiver(receiverId, workspaceId, filters, offset, limitPlusOne);
        return rows.map(serializeNotification);
      },
    );
  }

  private async owned(receiverId: string, id: string) {
    const n = await this.repo.findForReceiver(receiverId, id);
    if (!n) throw new NotFoundException("The required object does not exist.");
    return n;
  }

  async markRead(receiverId: string, id: string): Promise<void> {
    await this.owned(receiverId, id);
    await this.repo.setReadAt(id, new Date());
  }

  async markUnread(receiverId: string, id: string): Promise<void> {
    await this.owned(receiverId, id);
    await this.repo.setReadAt(id, null);
  }

  async archive(receiverId: string, id: string): Promise<void> {
    await this.owned(receiverId, id);
    await this.repo.setArchivedAt(id, new Date());
  }

  async unarchive(receiverId: string, id: string): Promise<void> {
    await this.owned(receiverId, id);
    await this.repo.setArchivedAt(id, null);
  }

  async markAllRead(slug: string, receiverId: string): Promise<void> {
    await this.repo.markAllRead(receiverId, await this.workspaceId(slug));
  }

  async unreadCount(slug: string, receiverId: string): Promise<{ count: number }> {
    return { count: await this.repo.unreadCount(receiverId, await this.workspaceId(slug)) };
  }
}
