export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export type SortOrder = 'asc' | 'desc';

export interface ListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: SortOrder;
  q?: string;
  [key: `filter.${string}`]: string | number | boolean | undefined;
}
