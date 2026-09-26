import { startRelay } from './relay.js';

export default async function globalSetup() {
	const relay = await startRelay();
	return async () => {
		await relay.stop();
	};
}
