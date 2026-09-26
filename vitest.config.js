import { defineConfig } from 'vitest/config';

// The core's specs only; the app under app/ runs its own.
export default defineConfig({
	test: { include: ['src/**/*.spec.js'] }
});
