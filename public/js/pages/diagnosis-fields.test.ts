import { describe, expect, it } from 'vitest';
import { diagnosis } from '@shared/contracts/work.contract';
import {
    DIAGNOSIS_FIELD_KEYS,
    DIAGNOSIS_TABS,
    diagnosisFieldId,
    diagnosisFormFromRow,
    emptyDiagnosisForm,
} from './diagnosis-fields';

describe('diagnosis field config', () => {
    it('covers every contract body field exactly once (work_id aside)', () => {
        const contractKeys = Object.keys(diagnosis.body.shape).filter(k => k !== 'work_id').sort();
        expect([...DIAGNOSIS_FIELD_KEYS].sort()).toEqual(contractKeys);
        expect(new Set(DIAGNOSIS_FIELD_KEYS).size).toBe(DIAGNOSIS_FIELD_KEYS.length);
    });

    it('marks exactly the contract-required fields as required', () => {
        const required = DIAGNOSIS_TABS.flatMap(t => t.sections.flatMap(s => s.fields))
            .filter(f => f.required)
            .map(f => f.key)
            .sort();
        expect(required).toEqual(['diagnosis', 'treatment_plan']);
    });

    it('keeps the historical element ids', () => {
        expect(diagnosisFieldId('dx_date')).toBe('dx-date');
        expect(diagnosisFieldId('c_li_a_po')).toBe('dx-c-li-a-po');
        expect(diagnosisFieldId('chief_complain')).toBe('dx-chief-complain');
    });
});

describe('diagnosis form seeding', () => {
    it('opens blank with today as the diagnosis date', () => {
        const form = emptyDiagnosisForm('2026-09-29');
        expect(form.dx_date).toBe('2026-09-29');
        expect(form.c_sna).toBe('');
        expect(Object.keys(form)).toHaveLength(DIAGNOSIS_FIELD_KEYS.length);
    });

    it('seeds only form keys from a stored row, NULL → blank', () => {
        const form = diagnosisFormFromRow(
            { id: 7, work_id: 3, dx_date: '2026-03-01', diagnosis: 'Class II div 1', c_sna: 84, o_overjet: null },
            '2026-09-29',
            v => v.slice(0, 10)
        );
        expect(form.dx_date).toBe('2026-03-01');
        expect(form.diagnosis).toBe('Class II div 1');
        expect(form.c_sna).toBe('84');
        expect(form.o_overjet).toBe('');
        expect(form).not.toHaveProperty('id');
        expect(form).not.toHaveProperty('work_id');
    });

    it('falls back to today when a stored row has no date', () => {
        const form = diagnosisFormFromRow({ dx_date: null }, '2026-09-29', v => v);
        expect(form.dx_date).toBe('2026-09-29');
    });
});
