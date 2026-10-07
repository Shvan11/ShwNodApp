import { describe, expect, it } from 'vitest';
import { updateWork } from '@shared/contracts/work.contract';
import { buildWorkUpdatePayload, type WorkEditFields } from './workUpdatePayload';

const opened: WorkEditFields = {
    total_required: 1500000,
    currency: 'IQD',
    type_of_work: '3',
    notes: 'upper arch first',
    status: 1,
    start_date: '2026-01-10',
    debond_date: '',
    f_photo_date: '',
    i_photo_date: '2026-01-10',
    estimated_duration: '18',
    dr_id: '4',
    notes_date: '',
    keyword_id_1: '2',
    keyword_id_2: '',
    keyword_id_3: '',
    keyword_id_4: '',
    keyword_id_5: '',
    discount: 0,
    discount_date: '',
    discount_reason: '',
};

const TODAY = '2026-10-06';

describe('buildWorkUpdatePayload', () => {
    it('sends nothing when the form holds no change', () => {
        expect(buildWorkUpdatePayload(7, { ...opened }, opened, TODAY)).toBeNull();
    });

    it('sends only the fields that changed, so untouched columns are never rewritten', () => {
        const payload = buildWorkUpdatePayload(7, { ...opened, notes: 'both arches', debond_date: '2027-06-01' }, opened, TODAY);
        expect(payload).toEqual({ workId: 7, notes: 'both arches', debond_date: '2027-06-01' });
        // The scenario this exists for: the total and the doctor a colleague changed
        // while the form was open are not in the body, so they are not put back.
        expect(payload).not.toHaveProperty('total_required');
        expect(payload).not.toHaveProperty('dr_id');
    });

    it('sends a cleared field as the empty value the server turns into NULL', () => {
        expect(buildWorkUpdatePayload(7, { ...opened, keyword_id_1: '', start_date: '' }, opened, TODAY))
            .toEqual({ workId: 7, keyword_id_1: '', start_date: '' });
    });

    it('leaves the discount alone unless one of its three fields changed', () => {
        // A legacy row: a discount on file with no date. Saving a note must not stamp today on it.
        const legacy = { ...opened, discount: 50000 };
        const payload = buildWorkUpdatePayload(7, { ...legacy, notes: 'x' }, legacy, TODAY);
        expect(payload).toEqual({ workId: 7, notes: 'x' });
    });

    it('sends a new discount with its date (today when none was typed) and reason', () => {
        expect(buildWorkUpdatePayload(7, { ...opened, discount: 100000, discount_reason: 'sibling' }, opened, TODAY))
            .toEqual({ workId: 7, discount: 100000, discount_date: TODAY, discount_reason: 'sibling' });
        expect(buildWorkUpdatePayload(7, { ...opened, discount: 100000, discount_date: '2026-09-30' }, opened, TODAY))
            .toEqual({ workId: 7, discount: 100000, discount_date: '2026-09-30', discount_reason: null });
    });

    it('clears all three when the discount is removed', () => {
        const discounted = { ...opened, discount: 100000, discount_date: '2026-09-30', discount_reason: 'sibling' };
        expect(buildWorkUpdatePayload(7, { ...discounted, discount: 0 }, discounted, TODAY))
            .toEqual({ workId: 7, discount: null, discount_date: null, discount_reason: null });
    });

    it('builds bodies the contract accepts without a doctor or any other untouched field', () => {
        const cases = [
            buildWorkUpdatePayload(7, { ...opened, notes: 'n' }, opened, TODAY),
            buildWorkUpdatePayload(7, { ...opened, dr_id: '9' }, opened, TODAY),
            buildWorkUpdatePayload(7, { ...opened, discount: 100000 }, opened, TODAY),
        ];
        for (const body of cases) {
            const parsed = updateWork.body.safeParse(body);
            expect(parsed.success).toBe(true);
        }
        expect(updateWork.body.parse(cases[0])).not.toHaveProperty('dr_id');
        expect(updateWork.body.parse(cases[1]).dr_id).toBe(9);
    });
});
