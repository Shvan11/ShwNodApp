import { authedContext, gotoSpa } from './auth.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:5274';
const URL = `${BASE}/patient/1253/photos/tp1`;

const { browser, context } = await authedContext({ base: BASE, headless: true });
const page = await context.newPage();
await gotoSpa(page, URL, { waitFor: '#dolph_gallery', settle: 1500 });

// Open a real photo in the lightbox.
await page.locator('#dolph_gallery a:not(#alogo)').first().click({ force: true });
await page.waitForSelector('.pswp--open', { timeout: 8000 });
await page.waitForSelector('.pswp__visibility-btn', { timeout: 5000 });
await page.waitForTimeout(500);

const readBtn = () => page.evaluate(() => {
  const btn = document.querySelector('.pswp__visibility-btn');
  const i = btn?.querySelector('i');
  return {
    iconClass: i?.className ?? null,
    iconColor: i ? getComputedStyle(i).color : null,
    title: btn?.getAttribute('title') ?? null,
  };
});

const initial = await readBtn();
console.log('INITIAL :', JSON.stringify(initial));

// Toggle #1 — flips visibility (real DB write; restored below).
await page.locator('.pswp__visibility-btn').click();
await page.waitForTimeout(900); // network POST + syncButton()
const afterToggle = await readBtn();
console.log('TOGGLED :', JSON.stringify(afterToggle));
await page.screenshot({ path: '/tmp/lightbox-toggled.png' });

// Toggle #2 — restore the original state.
await page.locator('.pswp__visibility-btn').click();
await page.waitForTimeout(900);
const restored = await readBtn();
console.log('RESTORED:', JSON.stringify(restored));

// Assertions.
const flipped = afterToggle.iconClass !== initial.iconClass;
const isSlashWhenHidden =
  (afterToggle.title?.includes('Make visible') && afterToggle.iconClass?.includes('fa-eye-slash')) ||
  (afterToggle.title?.includes('Hide') && afterToggle.iconClass === 'fas fa-eye');
const restoredOk = restored.iconClass === initial.iconClass;
console.log('\nCHECKS:');
console.log('  icon changed immediately after toggle :', flipped);
console.log('  hidden state == eye-slash             :', isSlashWhenHidden);
console.log('  original state restored               :', restoredOk);

await browser.close();
console.log('DONE');
