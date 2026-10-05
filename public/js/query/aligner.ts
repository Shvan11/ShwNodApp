/**
 * One invalidation for every aligner read.
 *
 * A set's lab status, unread doctor notes, delivered count and payments show in four
 * places at once: the patient's sets page, All Sets, a doctor's patient list and the
 * doctors' unread badges. No aligner write refreshed any of the lists, so the common
 * flow — list → patient → mark manufactured → back — showed the old row for up to the
 * 30 s staleTime (FE-F17-6), and a doctor added in Settings never reached the
 * Browse-by-Doctor cards or the announcement audience (FE-F18-10). The aligner reads
 * are small and only the mounted ones refetch, so every aligner write — and the work
 * lifecycle writes (status, delete, transfer), which change which sets are listed —
 * invalidates the whole `['aligner']` prefix.
 */
import { queryClient } from './client';
import { qk } from './keys';

export function invalidateAligner(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: qk.aligner.all() });
}
