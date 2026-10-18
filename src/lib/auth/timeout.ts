export const AUTH_SESSION_LOOKUP_TIMEOUT_MS = 3_000;

export type TimedResult<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Bound how long a caller waits for session resolution. This races rather than
 * aborts the underlying operation; Better Auth's internal D1 lookup has no signal.
 */
export async function withSessionLookupTimeout<T>(
	operation: () => Promise<T>,
): Promise<TimedResult<T>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			Promise.resolve()
				.then(operation)
				.then((value) => ({ timedOut: false as const, value })),
			new Promise<TimedResult<T>>((resolve) => {
				timer = setTimeout(
					() => resolve({ timedOut: true }),
					AUTH_SESSION_LOOKUP_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
