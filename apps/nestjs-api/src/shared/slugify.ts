/**
 * Approximation of Django's django.utils.text.slugify(value): lowercase, strip non-word chars,
 * collapse whitespace/dashes to a single dash. Used for State.slug (State.save).
 */
export function slugify(value: string): string {
  return value
    .toString()
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}
