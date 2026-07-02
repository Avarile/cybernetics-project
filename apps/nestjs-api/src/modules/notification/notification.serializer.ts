import type { Notification } from "./notification.schema";

export interface NotificationDTO {
  id: string;
  workspace: string;
  project: string | null;
  data: Record<string, unknown> | null;
  entity_identifier: string | null;
  entity_name: string;
  title: string;
  message: Record<string, unknown> | null;
  message_html: string | null;
  message_stripped: string | null;
  sender: string;
  triggered_by: string | null;
  receiver: string;
  read_at: Date | null;
  snoozed_till: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function serializeNotification(n: Notification): NotificationDTO {
  return {
    id: n.id,
    workspace: n.workspaceId,
    project: n.projectId,
    data: n.data,
    entity_identifier: n.entityIdentifier,
    entity_name: n.entityName,
    title: n.title,
    message: n.message,
    message_html: n.messageHtml,
    message_stripped: n.messageStripped,
    sender: n.sender,
    triggered_by: n.triggeredById,
    receiver: n.receiverId,
    read_at: n.readAt,
    snoozed_till: n.snoozedTill,
    archived_at: n.archivedAt,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  };
}
