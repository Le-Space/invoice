declare global {
	namespace App {}
	/** The commit this bundle was built from (vite.config.js); empty without git. */
	const __BUILD_COMMIT__: string;
	/** That commit's instant, ISO 8601 as git writes it; empty without git. */
	const __BUILD_DATE__: string;
	const __BUILD_RELEASE__: string;
}
export {};
