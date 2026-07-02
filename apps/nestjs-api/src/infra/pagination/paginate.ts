/**
 * Cursor pagination reproducing plane/utils/paginator.py::BasePaginator wire shape.
 * Cursor string = "<value>:<offset>:<is_prev>"; default when absent = "<perPage>:0:0".
 */
export interface CursorPageParams {
  cursor?: string;
  perPage?: number;
  defaultPerPage?: number;
  maxPerPage?: number;
}

export interface PaginatedResult<T> {
  grouped_by: string | null;
  sub_grouped_by: string | null;
  total_count: number;
  next_cursor: string;
  prev_cursor: string;
  next_page_results: boolean;
  prev_page_results: boolean;
  count: number;
  total_pages: number;
  total_results: number;
  extra_stats: unknown;
  results: T[];
}

export interface PageQuery {
  offset: number;
  /** fetch limit + 1 rows to detect a next page */
  limitPlusOne: number;
}

export function parseCursor(params: CursorPageParams): { page: number; limit: number } {
  const dflt = params.defaultPerPage ?? 1000;
  const cap = Math.max(params.maxPerPage ?? 1000, dflt);
  const perPage = Math.min(Number(params.perPage) || dflt, cap);
  const raw = params.cursor ?? `${perPage}:0:0`;
  const [value, offsetStr] = raw.split(":");
  const limit = parseInt(value, 10) || perPage;
  const page = parseInt(offsetStr, 10) || 0;
  return { page, limit };
}

export async function paginate<T>(
  params: CursorPageParams,
  countQuery: () => Promise<number>,
  pageQuery: (q: PageQuery) => Promise<T[]>,
  onResults?: (rows: T[]) => T[],
): Promise<PaginatedResult<T>> {
  const { page, limit } = parseCursor(params);
  const rows = await pageQuery({ offset: page * limit, limitPlusOne: limit + 1 });
  const hasNext = rows.length > limit;
  const sliced = rows.slice(0, limit);
  const results = onResults ? onResults(sliced) : sliced;
  const total = await countQuery();

  return {
    grouped_by: null,
    sub_grouped_by: null,
    total_count: total,
    next_cursor: `${limit}:${page + 1}:0`,
    prev_cursor: `${limit}:${page - 1}:1`,
    next_page_results: hasNext,
    prev_page_results: page > 0,
    count: results.length,
    total_pages: Math.ceil(total / limit),
    total_results: total,
    extra_stats: null,
    results,
  };
}
