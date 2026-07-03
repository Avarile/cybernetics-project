/**
 * Post-login redirection target, ported from Django:
 *   get_redirection_path   apps/api/plane/authentication/utils/redirection_path.py:8-46
 *
 * Branch order (do not reorder -- mirrors the Django source exactly):
 *   1. profile not onboarded              -> "onboarding"
 *   2. profile.last_workspace_id, and the user is an active member of it -> that workspace's slug
 *   3. any workspace the user is an active member of, earliest created  -> that workspace's slug
 *   4. any workspace_member_invites row for the user's email             -> "invitations"
 *   5. otherwise                                                          -> "create-workspace"
 *
 * Deliberate deviations, both matching Django's actual (not idealized) behavior:
 *  - Step 4 counts ALL invites for the email, accepted or not -- the Django queryset
 *    (`WorkspaceMemberInvite.objects.filter(email=user.email)`) has no `accepted` filter.
 *  - Steps 2/3 join workspace_members via a related-field lookup (`workspace_member__is_active`),
 *    which in Django does NOT route through WorkspaceMember's own soft-delete manager -- only
 *    Workspace's default manager (`deleted_at IS NULL` on `workspaces`) applies. We therefore filter
 *    `workspaces.deletedAt` but not `workspaceMembers.deletedAt`, to match.
 *  - Django's `Profile.objects.get_or_create(user=user)` creates a profile row as a side effect if
 *    none exists (a fresh profile is never onboarded). We don't perform that write here: a missing
 *    profile is treated the same as `is_onboarded=false` since the returned path is identical either
 *    way, and profile creation is owned by the signup flow, not this read-only redirect lookup.
 */
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import type { Database } from "../database/drizzle.module";
import { profiles, workspaceMembers, workspaces } from "../database/schema";
import { workspaceMemberInvites } from "../../modules/workspace/workspace-member-invite.schema";

export interface RedirectionUser {
  id: string;
  email: string;
}

async function activeMemberWorkspaceSlug(db: Database, userId: string, extra?: SQL): Promise<string | undefined> {
  const [row] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.memberId, userId), eq(workspaceMembers.isActive, true)),
    )
    .where(and(isNull(workspaces.deletedAt), extra))
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  return row?.slug;
}

export async function getRedirectionPath(db: Database, user: RedirectionUser): Promise<string> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);

  if (!profile?.isOnboarded) return "onboarding";

  if (profile.lastWorkspaceId) {
    const slug = await activeMemberWorkspaceSlug(db, user.id, eq(workspaces.id, profile.lastWorkspaceId));
    if (slug) return slug;
  }

  const fallbackSlug = await activeMemberWorkspaceSlug(db, user.id, undefined);
  if (fallbackSlug) return fallbackSlug;

  const [invite] = await db
    .select({ id: workspaceMemberInvites.id })
    .from(workspaceMemberInvites)
    .where(and(eq(workspaceMemberInvites.email, user.email), isNull(workspaceMemberInvites.deletedAt)))
    .limit(1);
  if (invite) return "invitations";

  return "create-workspace";
}
