/**
 * The day's composition, or null when nothing is rated `easy`.
 *
 * Two runtimes need this answer and they read the catalogue from different
 * places: the prerenderer from `build/catalogue.json` and the Worker from the
 * deployed `/catalogue.json` asset. Both call this function rather than picking
 * from their own copy.
 *
 * The order is a seeded shuffle walked one step per UTC day. Walking a
 * permutation means the pick circles without repeating a day running, and
 * deriving it purely from the date means a rebuild on the same day lands on the
 * same composition. Days count in UTC because that is the one timezone a
 * build-time pick can agree on with every visitor.
 */
export function dailyComposition<T extends { id: string; difficulty: string | null }>(
	list: readonly T[],
	now = new Date(),
): T | null {
	const easy = list.filter((row) => row.difficulty === "easy");
	if (easy.length === 0) return null;
	const day = Math.floor(now.getTime() / 86_400_000); // days since the epoch
	return easy[dailyCompositionIndex(day, easy.length)] ?? null;
}

/** The day's index into an already-filtered `easy` pool. */
function dailyCompositionIndex(day: number, length: number): number {
	if (length <= 0) throw new Error("No easy compositions to feature");
	const rand = mulberry32(0x4b65796d);
	const order = Array.from({ length }, (_, i) => i);
	for (let i = length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const swap = order[i];
		const target = order[j];
		if (swap === undefined || target === undefined)
			throw new Error("Daily composition shuffle index is out of bounds");
		order[i] = target;
		order[j] = swap;
	}
	const index = ((day % length) + length) % length;
	const selected = order[index];
	if (selected === undefined)
		throw new Error("Daily composition selection is out of bounds");
	return selected;
}

/** Deterministic PRNG (mulberry32), so every build shuffles the pool alike. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
