import { authedContext, gotoSpa } from './auth.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5274';
const URL = `${BASE}/patient/1253/photos/tp1`;

const { browser, context } = await authedContext({ base: BASE, headless: true });
const page = await context.newPage();
await gotoSpa(page, URL, { waitFor: '#dolph_gallery', settle: 1500 });

// Open a real photo in the PhotoSwipe lightbox.
await page.locator('#dolph_gallery a:not(#alogo)').first().click({ force: true });
await page.waitForSelector('.pswp--open', { timeout: 8000 });
await page.waitForTimeout(600);

// Fire a toast from page context (no DB write — same path the visibility toggle uses).
await page.evaluate(() => window.toast?.success('Visibility toast stacking test', 6000));
await page.waitForTimeout(500);

const result = await page.evaluate(() => {
  const toastC = document.querySelector('.toast-container');
  const toast = document.querySelector('.toast');
  const pswp = document.querySelector('.pswp');
  const zi = (el) => (el ? getComputedStyle(el).zIndex : null);

  // Ground truth: is the toast the top-most painted element where it sits?
  let topMostAtToast = null;
  if (toast) {
    const r = toast.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    topMostAtToast = el
      ? el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 40) +
        ' | inToast=' + !!el.closest('.toast-container') +
        ' | inPswp=' + !!el.closest('.pswp')
      : 'none';
  }

  return {
    pswpOpen: !!document.querySelector('.pswp--open'),
    toastZ: zi(toastC),
    pswpZ: zi(pswp),
    toastVisible: !!toast,
    topMostAtToast,
  };
});
console.log(JSON.stringify(result, null, 2));

await page.screenshot({ path: '/tmp/toast-over-lightbox.png' });
console.log('saved /tmp/toast-over-lightbox.png');

await browser.close();
console.log('DONE');
