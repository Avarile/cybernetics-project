/**
 * Produce description_stripped from description_html (plain text for search/display).
 * Django uses an HTML parser; this is a pragmatic strip that removes tags and collapses whitespace.
 * (A fuller parser can be swapped in later without changing callers.)
 */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length ? text : null;
}
