// Ported from Le-Space/belege (app/playwright.config.js) at 9a40d22 and
// published here under the MIT license by its author. Changed: no bridge.
// The app is built with VITE_E2E=true and served by `vite preview` on a port
// of its own, and Playwright never reuses a server it did not start.
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 4491);

export default defineConfig({
	testDir: 'e2e',
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 30_000 },
	webServer: {
		command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
		env: { VITE_E2E: 'true' },
		port,
		reuseExistingServer: false,
		timeout: 240_000
	},
	use: {
		baseURL: `http://localhost:${port}`,
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'on-first-retry'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
