/**
 * One invalidation for every cache that shows a patient's photos.
 *
 * A photo session write (create, re-date, rename, delete, a view removed or rendered
 * in the editor, a folder renamed under it) changes several reads at once: the session
 * tabs, every session's gallery, the hidden-from-patient marks, the working-files
 * thumbnails and the Files tree (the originals folder is named after the session).
 * Each call site used to refresh the one key it was looking at, so another tab, the
 * Files page or Compare kept showing what had been deleted or renamed (FE-F12-3,
 * FE-F14-2). Every photo write calls this instead.
 */
import { queryClient } from './client';
import { qk } from './keys';

type Id = string | number;

export function invalidatePatientPhotos(personId: Id, opts: { works?: boolean } = {}): Promise<void> {
  const keys: ReadonlyArray<readonly unknown[]> = [
    qk.patient.timepoints(personId),
    qk.patient.galleryAll(personId),
    qk.patient.photoVisibility(personId),
    qk.patient.workingFiles(personId),
    qk.patient.filesAll(personId),
    // A date-conflict override in the session dialog rewrites the Initial/Final photo
    // date on the patient's works (FE-F12-3d).
    ...(opts.works ? [qk.patient.works(personId), qk.work.root()] : []),
  ];
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
    () => undefined
  );
}

/**
 * Every patient's working-files listing, after a photo slot is renamed (Settings → Lookups →
 * Photo Slot Names): the listing carries the clinic's slot names, so one rename changes it
 * for every patient at once.
 */
export function invalidateAllWorkingFiles(): Promise<void> {
  // ['patient', id, 'working-files']: match the key factory's first and last parts.
  const [root, , leaf] = qk.patient.workingFiles(0);
  return queryClient.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] === root && queryKey[2] === leaf });
}
