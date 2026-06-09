import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--auto-select-desktop-capture-source=Entire screen'
      ]
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -w apps/coding/frontend',
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'PYTHONPATH=apps/coding/backend .venv/bin/uvicorn apps.coding.backend.main:app --port 8001',
      port: 8001,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev -w apps/meeting/frontend',
      port: 5174,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'PYTHONPATH=apps/meeting/backend .venv/bin/uvicorn apps.meeting.backend.main:app --port 8002',
      port: 8002,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev -w apps/jobs/frontend',
      port: 5175,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'PYTHONPATH=apps/jobs/backend .venv/bin/uvicorn apps.jobs.backend.main:app --port 8003',
      port: 8003,
      reuseExistingServer: !process.env.CI,
    }
  ],
});
