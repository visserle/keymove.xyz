<script lang="ts">
import { onMount } from "svelte";
import { Chessground } from "@lichess-org/chessground";
import type { Key } from "@lichess-org/chessground/types";

// `href` turns the static diagram into a link to the composition's solving
// board (the home page's featured diagram). The catalogue cards omit it.
let {
	fen,
	last = [],
	href,
	label,
}: { fen: string; last?: string[]; href?: string; label?: string } = $props();

let boardEl: HTMLElement | undefined = $state();

onMount(() => {
	const el = boardEl;
	if (!el) return;

	const api = Chessground(el, {
		fen,
		orientation: "white",
		coordinates: true, // lichess-style coords inside the board
		viewOnly: true,
		disableContextMenu: true,
		lastMove: last.length === 2 ? (last as Key[]) : undefined,
		highlight: { lastMove: true, check: true },
		animation: { enabled: false },
		drawable: { enabled: false },
	});
	return () => api.destroy();
});
</script>

<figure class="diagram">
  {#if href}
    <a class="board-frame board-frame--link" {href} aria-label={label}>
      <div class="cg-wrap" bind:this={boardEl}></div>
    </a>
  {:else}
    <div class="board-frame">
      <div class="cg-wrap" bind:this={boardEl}></div>
    </div>
  {/if}
</figure>
