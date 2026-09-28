/**
 * FE-F4-6 — the shared Modal's unsaved-work guard.
 *
 * Proves, against the running dev SPA, that a dismissal gesture on a modal that
 * declares `unsavedGuard` asks before it discards — and that an UNARMED modal
 * still dismisses instantly, which is what keeps the other ~66 render sites
 * (viewers, pickers, confirms) unchanged.
 *
 *   node scripts/e2e/smoke-modal-guard.mjs
 *
 * Fixture: patient 7639 / work 12979 (the one RA2 and RA3 used). Override with
 * E2E_PATIENT / E2E_BASE. Nothing is ever written — every run ends on "Keep
 * editing" or a discard, never on Save.
 */
import { authedContext, gotoSpa, E2E_BASE } from './auth.mjs';

const PATIENT = process.env.E2E_PATIENT || '7639';

const dialogs = (page) => page.locator('[role="dialog"]');
const dialogCount = (page) => dialogs(page).count();
// The amount field carries no id/name — it is the modal's one `inputLg` text box.
const amountField = (page) => page.locator('[role="dialog"] input[class*="inputLg"]').first();
const amountValue = (page) => amountField(page).inputValue();

let failures = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures += 1;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

async function openPayment(page) {
    await page.locator('.btn-add-payment').first().click({ force: true });
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
    await page.waitForTimeout(400);
}

const { browser, context } = await authedContext();
try {
    const page = await context.newPage();
    await gotoSpa(page, `${E2E_BASE}/patient/${PATIENT}/works`, { waitFor: '.btn-add-payment' });

    // 1 — SEEDED, NOT TYPED: the guard must NOT be armed by the modal's own
    //     pre-filled amount. This is the whole reason watchInput listens for a
    //     native input event instead of diffing values.
    console.log('\n1. opened, nothing typed → Escape');
    await openPayment(page);
    const seeded = await amountValue(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check(`   seeded amount was "${seeded}", dialogs after Escape`, await dialogCount(page), 0);

    // 2 — TYPED, then Escape: the confirm appears and the form survives.
    console.log('\n2. typed an amount → Escape → Keep editing');
    await openPayment(page);
    const amount = amountField(page);
    // Select-all + type, NOT fill(''): a clearing fill would absorb the very first
    // input event, which is the one that used to get eaten. The guard's listener
    // runs before React turns the keystroke into onChange, so if it ever forces a
    // render there the controlled input is rewritten and the first character is
    // lost ("12345" arriving as "2,345"). Assert the whole string.
    await amount.press('Control+a');
    await amount.pressSequentially('12345');
    await page.waitForTimeout(250);
    const typed = await amountValue(page);
    check('   the FIRST keystroke survived the guard', typed, '12,345');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check('   dialogs (payment + discard confirm)', await dialogCount(page), 2);
    // The structural reason watchInput uses a NATIVE listener: a stacked modal is
    // a PORTAL SIBLING, not a DOM descendant, so typing in it can never arm the
    // guard of the modal underneath. (React's synthetic events would bubble
    // through the react tree and do exactly that.)
    check('   stacked dialog is a sibling, not a descendant', await page.evaluate(() => {
        const d = document.querySelectorAll('[role="dialog"]');
        return d[0].contains(d[1]);
    }), false);
    await page.getByRole('button', { name: /keep editing/i }).click();
    await page.waitForTimeout(500);
    check('   dialogs after Keep editing', await dialogCount(page), 1);
    check(`   the typed amount survived ("${typed}")`, await amountValue(page), typed);

    // 3 — backdrop click on the same dirty form.
    console.log('\n3. same dirty form → backdrop click → Keep editing');
    const box = await dialogs(page).first().boundingBox();
    await page.mouse.click(Math.max(4, box.x / 2), Math.max(4, box.y / 2));
    await page.waitForTimeout(500);
    check('   dialogs (payment + discard confirm)', await dialogCount(page), 2);
    await page.getByRole('button', { name: /keep editing/i }).click();
    await page.waitForTimeout(400);
    check('   the typed amount survived', await amountValue(page), typed);

    // 4 — the header ✕ routes through the guard too, and Discard really closes.
    console.log('\n4. same dirty form → header ✕ → Discard');
    await page.locator('[role="dialog"] header button[aria-label]').first().click();
    await page.waitForTimeout(500);
    check('   dialogs (payment + discard confirm)', await dialogCount(page), 2);
    await page.getByRole('button', { name: /^discard$/i }).click();
    await page.waitForTimeout(600);
    check('   dialogs after Discard', await dialogCount(page), 0);

    // 5 — an UNGUARDED modal is untouched: no prop, no prompt, instant Escape.
    //     This is what keeps the other ~66 render sites exactly as they were.
    console.log('\n5. unguarded modal (payment history) → Escape');
    await page.locator('.btn-payments').first().click({ force: true });
    await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    check('   opened', await dialogCount(page), 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check('   dialogs after Escape', await dialogCount(page), 0);

    // 6 — the confirm chrome is translated: the strings live in common:unsaved.*,
    //     so a guarded modal on an Arabic session asks in Arabic with no work at
    //     the call site.
    console.log('\n6. language = ar → typed → Escape');
    await page.evaluate(() => localStorage.setItem('shwan_language', 'ar'));
    await gotoSpa(page, `${E2E_BASE}/patient/${PATIENT}/works`, { waitFor: '.btn-add-payment' });
    await openPayment(page);
    const ar = amountField(page);
    await ar.fill('');
    await ar.pressSequentially('999');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check('   dialogs', await dialogCount(page), 2);
    const arText = await dialogs(page).nth(1).innerText();
    check('   confirm is Arabic', /تغييرات غير محفوظة/.test(arText) && /تجاهل/.test(arText) && /متابعة التعديل/.test(arText), true);
    await page.getByRole('button', { name: /متابعة التعديل/ }).click();
    await page.waitForTimeout(400);
    check('   the typed amount survived', await amountValue(page), '999');
    await page.evaluate(() => localStorage.setItem('shwan_language', 'en'));

    console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`} — nothing was saved (never pressed Save).`);
} finally {
    await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
