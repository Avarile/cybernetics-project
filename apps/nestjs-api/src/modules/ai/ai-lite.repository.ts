import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../infra/database/drizzle.module";
import { projects, workspaces } from "../../infra/database/schema";

// WORKSPACE_LOGO / PROJECT_COVER assets resolve to this static path (FileAsset.asset_url).
const staticAssetUrl = (assetId: string): string => `/api/assets/v2/static/${assetId}/`;

export interface ProjectLite {
  id: string;
  identifier: string | null;
  name: string;
  cover_image: string | null;
  cover_image_url: string | null;
  logo_props: Record<string, unknown>;
  description: string | null;
}

export interface WorkspaceLite {
  name: string;
  slug: string;
  id: string;
  logo_url: string | null;
}

/** Lite reads for AI response enrichment — mirrors ProjectLiteSerializer / WorkspaceLiteSerializer. */
@Injectable()
export class AiLiteRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async projectLite(projectId: string): Promise<ProjectLite | null> {
    const [p] = await this.db
      .select({
        id: projects.id,
        identifier: projects.identifier,
        name: projects.name,
        coverImage: projects.coverImage,
        coverImageAssetId: projects.coverImageAssetId,
        logoProps: projects.logoProps,
        description: projects.description,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!p) return null;
    return {
      id: p.id,
      identifier: p.identifier,
      name: p.name,
      cover_image: p.coverImage ?? null,
      cover_image_url: p.coverImageAssetId ? staticAssetUrl(p.coverImageAssetId) : (p.coverImage ?? null),
      logo_props: p.logoProps ?? {},
      description: p.description ?? null,
    };
  }

  async workspaceLite(slug: string): Promise<WorkspaceLite | null> {
    const [w] = await this.db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, logo: workspaces.logo, logoAssetId: workspaces.logoAssetId })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);
    if (!w) return null;
    return {
      name: w.name,
      slug: w.slug,
      id: w.id,
      logo_url: w.logoAssetId ? staticAssetUrl(w.logoAssetId) : (w.logo ?? null),
    };
  }
}
