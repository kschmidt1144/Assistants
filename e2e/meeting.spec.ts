import { test, expect } from '@playwright/test';

test.describe('Meeting Copilot', () => {
  test('MTG-E-12: record, speaker identify, enroll, save/load', async ({ page }) => {
    page.on('console', msg => console.log('MEETING:', msg.text()));
    page.on('pageerror', err => console.log('MEETING ERR:', err.message));
    // Mock profiles list
    let profiles: any[] = [];
    await page.route('**/api/voice-profiles', async route => {
      await route.fulfill({ json: profiles });
    });

    // Mock enroll
    await page.route('**/api/enroll-speaker', async route => {
      const data = await route.request().postDataJSON();
      profiles.push({ name: data.name, num_samples: data.samples.length, created_at: Date.now() / 1000 });
      await route.fulfill({ json: { name: data.name, num_samples: data.samples.length } });
    });

    // Mock delete
    await page.route(/\/api\/voice-profiles\/.*/, async route => {
      if (route.request().method() === 'DELETE') {
        const url = new URL(route.request().url());
        const name = decodeURIComponent(url.pathname.split('/').pop() || '');
        profiles = profiles.filter(p => p.name !== name);
        await route.fulfill({ json: { ok: true } });
      } else {
        await route.continue();
      }
    });

    // Mock identify
    await page.route('**/api/identify-speaker', async route => {
      await route.fulfill({ json: { speaker: 'Test Speaker', score: 0.99 } });
    });

    // Mock meetings CRUD
    let meetings: any[] = [];
    let currentMeeting: any = null;

    await page.route('**/api/meetings', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: meetings });
      } else if (route.request().method() === 'POST') {
        const data = await route.request().postDataJSON();
        const m = { id: 'm-1', title: data.title || null, updated_at: Date.now() / 1000 };
        meetings.push(m);
        currentMeeting = { session: m, entries: [] };
        await route.fulfill({ json: m });
      } else {
        await route.continue();
      }
    });

    await page.route(/\/api\/meetings\/m-1\/entries/, async route => {
      if (route.request().method() === 'POST') {
        const data = await route.request().postDataJSON();
        currentMeeting.entries.push(...data.entries);
        await route.fulfill({ json: { added: data.entries.length } });
      } else {
        await route.continue();
      }
    });

    await page.route(/\/api\/meetings\/m-1$/, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: currentMeeting });
      } else if (route.request().method() === 'PUT') {
        const data = await route.request().postDataJSON();
        if (data.title !== undefined) currentMeeting.session.title = data.title;
        if (data.summary !== undefined) {
          currentMeeting.session.metadata = currentMeeting.session.metadata || {};
          currentMeeting.session.metadata.summary = data.summary;
        }
        await route.fulfill({ json: { ok: true } });
      } else {
        await route.continue();
      }
    });

    // Note actions
    await page.route('**/api/summarize', async route => {
      await route.fulfill({ json: { summary: 'Mocked summary' } });
    });

    await page.goto('http://localhost:5174');

    // Because we are using chromium with --use-fake-device-for-media-stream
    // We can start recording.
    // The SpeechRecognition API is mocked or natively supported in Chrome,
    // but --use-fake-ui-for-media-stream allows it.
    // However, fake Web Speech might not yield transcriptions. We'll just verify the UI toggles.
    await page.click('text=▶ Record');
    await expect(page.locator('text=● Recording')).toBeVisible();

    // The audio worklet will post to identify-speaker which returns "Test Speaker"
    await expect(page.locator('text=speaking: Test Speaker')).toBeVisible({ timeout: 15000 });

    await page.click('text=● Recording'); // Stop
    
    // Enroll modal
    await page.click('text=Profiles');
    await page.fill('input[placeholder="Speaker name"]', 'Test Speaker');
    
    // We can't easily record a clip inside Playwright fake media unless we wait
    // We can try to click "Record sample" and wait for it
    await page.click('text=Record sample');
    // Wait for the recording to finish (2 seconds)
    await page.waitForTimeout(2500);
    
    await page.click('text=Save profile');
    
    // Check if it's listed
    await expect(page.locator('.profile-row')).toContainText('Test Speaker');
    await page.click('text=Delete'); // Delete the profile
    await expect(page.locator('.profile-row')).not.toBeVisible();
    await page.click('text=Close');

    // We might not have entries to save if Web Speech didn't emit words in the fake stream.
    // But we can test the Save flow
    await page.fill('input[placeholder="Meeting topic…"]', 'E2E Topic');
    await page.click('text=Save');

    // Wait for saving to finish
    await expect(page.locator('text=Saving…')).not.toBeVisible();
    await expect(page.locator('text=Save')).toBeVisible();
    
    // Load it back
    // To trigger load, we select it from history
    await page.selectOption('select', 'm-1');
    await expect(page.locator('input[placeholder="Meeting topic…"]')).toHaveValue('E2E Topic');
  });
});
