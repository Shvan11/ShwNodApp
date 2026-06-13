/**
 * Smoke test: log in (cached), open the aligner "All Sets" list, drill into the
 * first patient's sets, and report any horizontal overflow + screenshot.
 *
 *   node scripts/e2e/smoke-aligner.mjs              # desktop viewport
 *   node scripts/e2e/smoke-aligner.mjs --mobile     # 412px (Galaxy S23-ish)
 *
 * Proves the reusable harness in ./auth.mjs works without re-hitting login.
 */
import { authedContext, gotoSpa, findHorizontalOverflow, E2E_BASE } from './auth.mjs';

const mobile = process.argv.includes('--mobile');
const { browser, context } = await authedContext({ mobile });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

try {
  await gotoSpa(page, `${E2E_BASE}/aligner/all-sets`, { waitFor: 'table tbody tr' });
  console.log(`all-sets rows: ${await page.locator('table tbody tr').count()}`);

  await page.locator('table tbody tr').first().click({ force: true });
  await page.waitForSelector('.aligner-set-card', { timeout: 25000 });
  await page.waitForTimeout(1000);
  console.log('patient page:', page.url());

  const o = await findHorizontalOverflow(page);
  console.log(`viewport=${o.viewport} scrollWidth=${o.scrollWidth} overflow=${o.scrollWidth - o.viewport}px`);
  if (o.offenders.length) {
    console.log('overflow offenders:');
    o.offenders.forEach((x) => console.log(`  ${x.sel} w=${x.width} right=${x.right} "${x.text}"`));
  }

  const shot = mobile ? 'scripts/e2e/last-run-mobile.png' : 'scripts/e2e/last-run.png';
  await page.screenshot({ path: shot });
  console.log('screenshot:', shot);
} catch (e) {
  console.log('ERROR:', e.message);
  await page.screenshot({ path: 'scripts/e2e/last-run-error.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
