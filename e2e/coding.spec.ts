import { test, expect } from '@playwright/test';

test.describe('Coding Copilot', () => {
  test('COD-E-12: fake-media -> Camera -> mock analyze', async ({ page }) => {
    page.on('console', msg => console.log('CODING:', msg.text()));
    page.on('pageerror', err => console.log('CODING ERR:', err.message));

    // We mock the HTTP endpoints
    await page.route('**/api/analyze', async route => {
      await route.fulfill({ json: { response: 'mocked analyze text' } });
    });

    // Go to the Coding Copilot app (port 5173 is the dev server port from our config)
    await page.goto('http://localhost:5173');

    // The app starts. Start fake camera.
    await page.click('text=📷 Camera');
    
    // Make sure we have camera feed ready
    await expect(page.locator('video')).toHaveJSProperty('readyState', 4);

    // Select an analysis template
    await page.selectOption('select:has-text("⌨ Templates…")', { label: 'Explain' });

    // Expect the mocked response to appear
    await expect(page.locator('text=mocked analyze text')).toBeVisible({ timeout: 10000 });
  });
});
