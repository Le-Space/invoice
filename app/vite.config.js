// Ported from Le-Space/belege (app/vite.config.js) at 9a40d22 and published
// here under the MIT license by its author.
// Ported from Le-Space/simple-todo apps/invoice01 (vite.config.js) at 56647d5.
// Changed: the build stamp is the last commit touching the app (not a
// chapter's), no version defines; unit tests run in Node rather than in a
// browser, because the store test drives a real OrbitDB and Helia there.
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const isVitest = Boolean(process.env.VITEST);

/**
 * The commit the footer names, and that commit's instant — never the build
 * clock (Le-Space time and date convention), so a rebuild of one commit gives
 * the same bytes. The last commit that touched the app or what it is built
 * with; a change to the core alone restamps it too. Without git, two
 * empty strings, and the footer leaves the stamp out.
 */
function lastAppCommit() {
	try {
		const cwd = fileURLToPath(new URL('.', import.meta.url));
		const out = execFileSync(
			'git',
			[
				'log',
				'-1',
				'--format=%H%n%cI',
				'--',
				'.',
				'../src',
				'../package.json',
				'../pnpm-lock.yaml'
			],
			{ cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		).trim();
		const [commit = '', date = ''] = out.split('\n');
		return commit && date ? { commit, date } : { commit: '', date: '' };
	} catch {
		return { commit: '', date: '' };
	}
}

const built = lastAppCommit();

/**
 * The release this build is: `v0.2.0` on a release tag, `v0.2.0+3` three
 * commits after it (git describe), else the version in package.json (a
 * checkout without tags, e.g. a shallow CI clone of a tag, where that version
 * is the release's). The release workflow writes the version before tagging.
 */
function releaseName() {
	const cwd = fileURLToPath(new URL('.', import.meta.url));
	const version = JSON.parse(
		readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
	).version;
	try {
		const described = execFileSync('git', ['describe', '--tags', '--match', 'v[0-9]*'], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		const m = /^(v\d+\.\d+\.\d+)(?:-(\d+)-g[0-9a-f]+)?$/.exec(described);
		if (m) return m[2] ? `${m[1]}+${m[2]}` : m[1];
	} catch {
		// no tags here: the package version
	}
	return typeof version === 'string' && version ? `v${version}` : '';
}

export default defineConfig({
	test: {
		include: ['src/**/*.spec.js'],
		environment: 'node',
		testTimeout: 30_000
	},
	define: {
		__BUILD_COMMIT__: JSON.stringify(built.commit),
		__BUILD_DATE__: JSON.stringify(built.date),
		__BUILD_RELEASE__: JSON.stringify(releaseName())
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		// libp2p, Helia and the identity provider still reach for Node's
		// `Buffer`, `process` and friends in a browser. Node has them already.
		...(isVitest
			? []
			: [
					nodePolyfills(
						/** @type {any} */ ({
							include: ['buffer', 'process', 'events', 'util', 'crypto', 'stream'],
							globals: { Buffer: true, global: true, process: true },
							protocolImports: true
						})
					)
				])
	]
});
