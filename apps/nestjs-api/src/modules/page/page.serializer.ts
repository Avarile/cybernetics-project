import type { Page } from "./page.schema";

// PageSerializer uses bare FK names (owned_by, parent, workspace) — the "__all__"-style, like the
// estimate/view domains — not explicit *_id fields. `labels` is write-only so it is NOT emitted.
export interface PageAnnotations {
  is_favorite: boolean;
  label_ids: string[];
  project_ids: string[];
}

export interface PageDTO {
  id: string;
  name: string;
  owned_by: string;
  access: number;
  color: string | null;
  parent: string | null;
  is_favorite: boolean;
  is_locked: boolean;
  archived_at: string | null;
  workspace: string;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
  view_props: Record<string, unknown> | null;
  logo_props: Record<string, unknown> | null;
  label_ids: string[];
  project_ids: string[];
}

// PageDetailSerializer = PageSerializer + description_html.
export interface PageDetailDTO extends PageDTO {
  description_html: string | null;
}

export function serializePage(p: Page, ann: PageAnnotations): PageDTO {
  return {
    id: p.id,
    name: p.name,
    owned_by: p.ownedBy,
    access: p.access,
    color: p.color,
    parent: p.parentId,
    is_favorite: ann.is_favorite,
    is_locked: p.isLocked,
    archived_at: p.archivedAt,
    workspace: p.workspaceId,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    created_by: p.createdBy,
    updated_by: p.updatedBy,
    view_props: p.viewProps,
    logo_props: p.logoProps,
    label_ids: ann.label_ids,
    project_ids: ann.project_ids,
  };
}

export function serializePageDetail(p: Page, ann: PageAnnotations): PageDetailDTO {
  return { ...serializePage(p, ann), description_html: p.descriptionHtml };
}
