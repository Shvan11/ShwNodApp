/**
 * Lab case tracker — board/detail reads (thin `useQuery` wrappers over the
 * `query/queries.ts` factories) + mutations via `useApiMutation` (the standard
 * for new mutations — see PatientSlideshow.tsx). Every mutation invalidates
 * `qk.labCases.all()` (board + detail) PLUS `qk.work.detailsList(workId)` so the
 * work-card badge refreshes too. The raw `lab_cases` row the mutations return
 * carries no `work_id` (only the assembled board/detail row does), so callers
 * pass `workId` explicitly — the work card has it as a prop; the board/modal
 * read it off the loaded case row.
 */
import { useQuery } from '@tanstack/react-query';
import { postJSON, patchJSON } from '@/core/http';
import { qk } from '@/query/keys';
import { useApiMutation } from '@/query/useApiMutation';
import { labCasesBoardQuery, labCaseQuery } from '@/query/queries';
import * as labCaseContract from '@shared/contracts/lab-case.contract';
import type {
  LabCaseRow,
  ListLabCasesQuery,
  CreateLabCaseBody,
  AdvanceLabCaseBody,
  RemakeLabCaseBody,
  HoldLabCaseBody,
  ResumeLabCaseBody,
  UpdateLabCaseBody,
  CancelLabCaseBody,
} from '@shared/contracts/lab-case.contract';

/** The board/list read — backs both the /lab-tracking board and the work-card badge fallback. */
export function useLabCasesBoard(filters: ListLabCasesQuery = {}) {
  return useQuery(labCasesBoardQuery(filters));
}

/** One case + its event timeline (LabCaseModal track mode). */
export function useLabCase(id: number | null | undefined) {
  return useQuery({ ...labCaseQuery(id ?? 0), enabled: id != null });
}

const invalidateCase = (workId: number) => [qk.labCases.all(), qk.work.detailsList(workId)];

/** POST /api/lab-cases — Start Lab Flow (or reactivate a cancelled case). */
export function useCreateLabCase() {
  return useApiMutation<LabCaseRow, CreateLabCaseBody & { workId: number }>({
    mutationFn: ({ workId: _workId, ...body }) =>
      postJSON<LabCaseRow, CreateLabCaseBody>('/api/lab-cases', body, {
        schema: labCaseContract.createLabCase.response,
      }),
    invalidate: (_data, vars) => invalidateCase(vars.workId),
  });
}

/** POST /api/lab-cases/:id/advance — guarded stage transition. */
export function useAdvanceLabCase() {
  return useApiMutation<LabCaseRow, AdvanceLabCaseBody & { id: number; workId: number }>({
    mutationFn: ({ id, workId: _workId, ...body }) =>
      postJSON<LabCaseRow, AdvanceLabCaseBody>(`/api/lab-cases/${id}/advance`, body, {
        schema: labCaseContract.advanceLabCase.response,
      }),
    invalidate: (_data, vars) => invalidateCase(vars.workId),
  });
}

/** POST /api/lab-cases/:id/remake — refuse/remake (Send back). */
export function useRemakeLabCase() {
  return useApiMutation<LabCaseRow, RemakeLabCaseBody & { id: number; workId: number }>({
    mutationFn: ({ id, workId: _workId, ...body }) =>
      postJSON<LabCaseRow, RemakeLabCaseBody>(`/api/lab-cases/${id}/remake`, body, {
        schema: labCaseContract.remakeLabCase.response,
      }),
    invalidate: (_data, vars) => invalidateCase(vars.workId),
  });
}

/** POST /api/lab-cases/:id/hold */
export function useHoldLabCase() {
  return useApiMutation<LabCaseRow, HoldLabCaseBody & { id: number; workId: number }>({
    mutationFn: ({ id, workId: _workId, ...body }) =>
      postJSON<LabCaseRow, HoldLabCaseBody>(`/api/lab-cases/${id}/hold`, body, {
        schema: labCaseContract.holdLabCase.response,
      }),
    invalidate: (_data, vars) => invalidateCase(vars.workId),
  });
}

/** POST /api/lab-cases/:id/resume */
export function useResumeLabCase() {
  return useApiMutation<LabCaseRow, ResumeLabCaseBody & { id: number; workId: number }>({
    mutationFn: ({ id, workId: _workId, ...body }) =>
      postJSON<LabCaseRow, ResumeLabCaseBody>(`/api/lab-cases/${id}/resume`, body, {
        schema: labCaseContract.resumeLabCase.response,
      }),
    invalidate: (_data, vars) => invalidateCase(vars.workId),
  });
}

/** PATCH /api/lab-cases/:id — edit metadata (lab/due date/rush/note). */
export function useUpdateLabCase() {
  return useApiMutation<LabCaseRow, UpdateLabCaseBody & { id: number; workId: number }>({
    mutationFn: ({ id, workId: _workId, ...body }) =>
      patchJSON<LabCaseRow, UpdateLabCaseBody>(`/api/lab-cases/${id}`, body, {
        schema: labCaseContract.updateLabCase.response,
      }),
    invalidate: (_data, vars) => invalidateCase(vars.workId),
  });
}

/** POST /api/lab-cases/:id/cancel — soft close. */
export function useCancelLabCase() {
  return useApiMutation<LabCaseRow, CancelLabCaseBody & { id: number; workId: number }>({
    mutationFn: ({ id, workId: _workId, ...body }) =>
      postJSON<LabCaseRow, CancelLabCaseBody>(`/api/lab-cases/${id}/cancel`, body, {
        schema: labCaseContract.cancelLabCase.response,
      }),
    invalidate: (_data, vars) => invalidateCase(vars.workId),
  });
}
