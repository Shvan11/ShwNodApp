/**
 * The clinic's common photo-session names, in list order — the `time_point_names` lookup
 * (Settings → Lookups). Falls back to the names the product ships with while the read is
 * in flight, has failed, or the list was emptied, so the result is never empty and a
 * session can always be named.
 */
import { useQuery } from '@tanstack/react-query';
import { timepointNamesQuery } from '@/query/queries';
import { DEFAULT_TIME_POINT_NAMES } from '@shared/time-point-names';

export function useTimepointNames(): string[] {
  const { data } = useQuery(timepointNamesQuery());
  return data && data.length > 0 ? data.map((row) => row.name) : [...DEFAULT_TIME_POINT_NAMES];
}
