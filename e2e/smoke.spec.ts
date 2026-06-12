/**
 * Read-only smoke flows: the three load-bearing screens render with real data
 * behind a real session. The default target is the LIVE server (see
 * playwright.config.ts) — these specs must never mutate anything.
 */
import { expect, test } from '@playwright/test';

/** The app shell (UniversalHeader) rendered and no error boundary tripped. */
async function expectHealthyShell(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('h1.clinic-name')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

test('dashboard renders behind auth', async ({ page }) => {
  await page.goto('/dashboard');
  await expectHealthyShell(page);
});

test('patient page loads a real patient through the shell loader', async ({ page, request }) => {
  // Pick a real person id via the API (read-only) instead of hardcoding one.
  // /api/patients/phones rows are { id, name, phone } (patient.contract.ts).
  const res = await request.get('/api/patients/phones');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data?: Array<{ id?: number }> } | Array<{ id?: number }>;
  const patients = Array.isArray(body) ? body : (body.data ?? []);
  const personId = patients.find((p) => typeof p.id === 'number')?.id;
  test.skip(personId === undefined, 'no patients in this database');

  await page.goto(`/patient/${personId}/works`);
  await expectHealthyShell(page);
  // The works page rendered something for this patient (not a blank error state).
  await expect(page.locator('#app-root')).not.toBeEmpty();
});

test('daily appointments screen renders its stats', async ({ page }) => {
  await page.goto('/appointments');
  await expectHealthyShell(page);
  await expect(page.getByText('Checked In').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Waiting').first()).toBeVisible();
});
