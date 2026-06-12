/**
 * Logs in once through the real login page and persists the session cookie as
 * storageState for the smoke project. Credentials come from env when set
 * (E2E_USERNAME / E2E_PASSWORD), falling back to the documented test account.
 */
import { expect, test as setup } from '@playwright/test';

const AUTH_FILE = 'e2e/.auth/admin.json';

setup('authenticate', async ({ page }) => {
  const username = process.env.E2E_USERNAME || 'Admin';
  const password = process.env.E2E_PASSWORD || 'Yarmok11';

  await page.goto('/login.html');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#loginButton').click();

  // login.html redirects to /dashboard on success.
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page.locator('h1.clinic-name')).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
