import { describe, expect, it } from 'vitest';
import { ROUTE_TITLE_KEYS, composeDocumentTitle, routeTitleKey, screenHeadingKey } from './routeTitle';
import en from '../locales/en/common.json';
import ar from '../locales/ar/common.json';

describe('routeTitleKey', () => {
    it.each([
        ['/', 'dashboard'],
        ['/dashboard', 'dashboard'],
        ['/appointments', 'appointments'],
        ['/calendar', 'calendar'],
        ['/patient-management', 'patientSearch'],
        ['/tasks/history', 'tasksHistory'],
        ['/settings', 'settings'],
        ['/settings/users', 'settings'],
        ['/templates', 'templates'],
        ['/templates/designer/12', 'templateDesigner'],
        ['/aligner', 'aligners'],
        ['/aligner/all-sets', 'alignerSets'],
        ['/aligner/patient/9867', 'alignerSets'],
        ['/aligner/doctor/3', 'aligners'],
        ['/aligner/doctor/3/patient/9867', 'aligners'],
        ['/stand/pos', 'standPos'],
        ['/send', 'whatsappSend'],
        ['/send-message', 'sendMessage'],
    ])('%s → %s', (path, key) => {
        expect(routeTitleKey(path)).toBe(key);
    });

    it.each([
        ['/patient/7845', 'works'],
        ['/patient/7845/works', 'works'],
        ['/patient/7845/patient-info', 'patientInfo'],
        ['/patient/7845/photos/tp0', 'photos'],
        ['/patient/7845/edit-appointment/55', 'editAppointment'],
        ['/patient/7845/work/13015/diagnosis', 'diagnosis'],
        ['/patient/7845/work', 'works'],
        ['/patient/7845/working-files', 'files'],
        ['/patient/new/add', 'addPatient'],
    ])('patient page %s → %s', (path, key) => {
        expect(routeTitleKey(path)).toBe(key);
    });

    it('tells an edit from a new entry by the query string', () => {
        expect(routeTitleKey('/patient/7845/new-work')).toBe('newWork');
        expect(routeTitleKey('/patient/7845/new-work', '?workId=13015')).toBe('editWork');
        expect(routeTitleKey('/patient/7845/new-visit', '?workId=13015')).toBe('newVisit');
        expect(routeTitleKey('/patient/7845/new-visit', '?workId=13015&visitId=4')).toBe('editVisit');
    });

    it('ignores a trailing slash', () => {
        expect(routeTitleKey('/expenses/')).toBe('expenses');
    });

    it('does not read an aligner WORK id as a patient page', () => {
        // /aligner/patient/:workId must never fall into the /patient/:id branch.
        expect(routeTitleKey('/aligner/patient/9867')).toBe('alignerSets');
    });

    it('returns null for a path it does not know, so the title is left alone', () => {
        expect(routeTitleKey('/nope')).toBeNull();
        expect(routeTitleKey('/patient/7845/not-a-page')).toBeNull();
    });
});

describe('the titles catalog', () => {
    it('has an English and an Arabic string for every key', () => {
        for (const key of ROUTE_TITLE_KEYS) {
            expect(en.titles[key], `en titles.${key}`).toBeTruthy();
            expect(ar.titles[key], `ar titles.${key}`).toBeTruthy();
        }
    });

    it('has no entry the map can never produce', () => {
        expect(Object.keys(en.titles).sort()).toEqual([...ROUTE_TITLE_KEYS].sort());
    });
});

describe('composeDocumentTitle', () => {
    it('puts the most specific part first and drops the empty ones', () => {
        expect(composeDocumentTitle(['Works', 'Sara Ali', 'Bright Smile'])).toBe('Works · Sara Ali · Bright Smile');
        expect(composeDocumentTitle(['Works', null, '  ', 'Bright Smile'])).toBe('Works · Bright Smile');
        expect(composeDocumentTitle([null, undefined, ''])).toBe('');
    });
});

describe('screenHeadingKey', () => {
    it.each([
        ['/dashboard', 'dashboard'],
        ['/patient/7845/works', 'works'],
        ['/patient/7845/new-visit?visitId=3', 'editVisit'],
        ['/settings/users', 'settings'],
        ['/aligner/patient/9867', 'alignerSets'],
        // its own <h1> is hidden by CSS on a wide screen
        ['/patient/7845/new-appointment', 'newAppointment'],
    ])('%s gets the hidden heading %s', (url, key) => {
        const [path, search = ''] = url.split('?');
        expect(screenHeadingKey(path, search && `?${search}`)).toBe(key);
    });

    it.each(['/expenses', '/statistics', '/stand/pos', '/patient/7845/work/13015/diagnosis', '/templates/designer/12'])(
        '%s draws its own <h1>, so it gets none',
        (path) => {
            expect(screenHeadingKey(path)).toBeNull();
        },
    );

    it('is null where the route has no title', () => {
        expect(screenHeadingKey('/chair-display')).toBeNull();
    });
});
