// Ported from Le-Space/simple-todo apps/invoice01 (svelte.config.js) at 56647d5.
// Changed: no shared brand assets folder; an SPA fallback page, because every
// route renders in the browser only (the data lives in IndexedDB).
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
