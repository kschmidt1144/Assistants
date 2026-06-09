import { test, expect } from '@playwright/test';

test.describe('Jobs Copilot', () => {
  test('JOB-E-15: paste JD -> parse -> track -> tailor', async ({ page }) => {
    page.on('console', msg => console.log('JOBS:', msg.text()));
    page.on('pageerror', err => console.log('JOBS ERR:', err.message));
    // Mock the backend
    await page.route(/\/api\/stats/, async route => {
      console.log('MOCK stats');
      await route.fulfill({ json: {} });
    });
    let apps: any[] = [];
    await page.route(/\/api\/applications(\?.*)?$/, async route => {
      if (route.request().method() === 'GET') {
        console.log('MOCK get applications', apps);
        await route.fulfill({ json: apps });
      } else if (route.request().method() === 'POST') {
        const data = await route.request().postDataJSON();
        const app = { ...data, id: 'a-1', status: 'APPLIED', status_history: [], created_at: Date.now()/1000 };
        apps.push(app);
        console.log('MOCK post applications', app);
        await route.fulfill({ json: app });
      } else {
        await route.continue();
      }
    });

    await page.route(/\/api\/parse-jd/, async route => {
      console.log('MOCK parse-jd');
      await route.fulfill({ json: {
        title: 'Mock Title',
        company: 'Mock Co',
        seniority: 'Mid',
        work_type: 'Remote',
        employment_type: 'Full-time',
        required_skills: ['A', 'B'],
        preferred_skills: []
      }});
    });

    await page.route(/\/api\/tailor/, async route => {
      await route.fulfill({ json: {
        resume_markdown: '# Tailored Resume\n\nIt works!',
        ats: { score: 95, missing: [] },
        iterations: 1
      }});
    });

    await page.goto('http://localhost:5175');

    // Go to add job
    await page.click('text=Add Job');
    await page.fill('textarea[placeholder="Paste the job description…"]', 'This is a test JD');
    await page.click('text=Parse JD (AI)');

    await expect(page.locator('text=Mock Title')).toBeVisible();

    await page.getByRole('button', { name: 'Track', exact: true }).click();

    // Should now be in the list
    await expect(page.locator('.appcard')).toContainText('Mock Title');
    
    // Select it
    await page.click('.appcard');
    await expect(page.locator('h2')).toHaveText('Mock Title');

    // Tailor
    await page.click('text=Tailor resume');
    await expect(page.locator('text=95')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=It works!')).toBeVisible();
  });
});
