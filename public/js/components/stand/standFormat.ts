import { formatLocaleDateTime } from '../../utils/formatters';

/**
 * A Stand timestamp (a sale's `sale_date`, a movement's `movement_date`) as
 * "Oct 4, 2026, 07:31 PM": the locale-pinned formatter with a named month, so the
 * day/month order can't be misread. The history table and the sale dialog each
 * carried a hand-rolled DD/MM copy (FE-F19-12).
 */
export function formatStandDateTime(value: string): string {
  return formatLocaleDateTime(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
