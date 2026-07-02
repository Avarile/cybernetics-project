/**
 * Extract user-mention ids from ProseMirror description HTML — port of extract_mentions
 * (plane/bgtasks/notification_task.py), which parses <mention-component entity_name="user_mention"
 * entity_identifier="<uuid>"> tags. Regex-based (attribute order independent) instead of BeautifulSoup.
 */
export function extractUserMentions(html: string | null | undefined): string[] {
  if (!html) return [];
  const out = new Set<string>();
  const tagRe = /<mention-component\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    const name = /entity_name\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    const id = /entity_identifier\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (name === "user_mention" && id) out.add(id);
  }
  return [...out];
}

/** From a raw JSON-string activity payload, pull description_html then its mentions. */
export function mentionsFromInstance(instance: unknown): string[] {
  if (instance === null || instance === undefined) return [];
  try {
    const data = typeof instance === "string" ? (JSON.parse(instance) as Record<string, unknown>) : (instance as Record<string, unknown>);
    return extractUserMentions(data.description_html as string | undefined);
  } catch {
    return [];
  }
}
