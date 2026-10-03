/**
 * Pure catalogue filtering and rendering, shared by the Worker-rendered list
 * pages (`/library`, `/collections`). Keeping one renderer is what makes the
 * initial server HTML and any later client-side update agree on filters, paging
 * and card markup.
 */

import { levelLabel, taskFor } from "./display";
import { escapeHtml } from "./html";
import { type CompositionRow, LEVELS } from "./types";

/** The columns a card or a listing needs; `getCatalogue()` returns more. */
export type CatalogueComposition = Pick<
	CompositionRow,
	| "id"
	| "fen"
	| "stipulation"
	| "mate_in"
	| "composer"
	| "coauthors"
	| "year"
	| "published_in"
	| "source"
	| "theme"
	| "difficulty"
>;

export const PER_PAGE = 24;

export type CatalogueProgressState = "in-progress" | "solved";
export type CatalogueProgress = ReadonlyMap<string, CatalogueProgressState>;

/**
 * The catalogue's default order. Ids are opaque strings, so there is no
 * "number" to sort by; composer (then id) is the meaningful default.
 */
export const DEFAULT_SORT = "composer";

/** The query-string state of a list page, in the order it is serialised. */
export interface State {
	stip: string;
	status: "" | "unsolved" | "in-progress" | "solved";
	composer: string;
	level: string;
	sort: string;
	page: number;
}

export function matches(
	p: CatalogueComposition,
	s: State,
	progress?: CatalogueProgress,
): boolean {
	if (s.stip && s.stip !== "all" && p.stipulation !== s.stip) return false;
	if (s.status === "unsolved" && progress?.has(p.id)) return false;
	if (
		s.status !== "" &&
		s.status !== "unsolved" &&
		progress?.get(p.id) !== s.status
	)
		return false;
	if (s.composer && p.composer !== s.composer) return false;
	if (
		s.level === "unassigned" || s.level === "unrated"
			? p.difficulty !== null
			: s.level && p.difficulty !== s.level
	)
		return false;
	return true;
}

export function sortList(
	list: CatalogueComposition[],
	sort: string,
): CatalogueComposition[] {
	const byId = (a: CatalogueComposition, b: CatalogueComposition): number =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	const sorters: Record<
		string,
		(a: CatalogueComposition, b: CatalogueComposition) => number
	> = {
		composer: (a, b) => {
			if (!a.composer && !b.composer) return byId(a, b);
			if (!a.composer) return 1; // anonymous last
			if (!b.composer) return -1;
			return a.composer.localeCompare(b.composer) || byId(a, b);
		},
		year: (a, b) => (a.year || 9999) - (b.year || 9999) || byId(a, b),
		level: (a, b) => {
			const rank = (difficulty: string | null): number => {
				const index = difficulty
					? LEVELS.indexOf(difficulty as (typeof LEVELS)[number])
					: -1;
				return index < 0 ? LEVELS.length : index;
			};
			return rank(a.difficulty) - rank(b.difficulty) || byId(a, b);
		},
	};
	return list.slice().sort(sorters[sort] ?? sorters[DEFAULT_SORT]);
}

/** A page link that keeps the current filters. */
export function pageHref(search: string, page: number): string {
	const next = new URLSearchParams(search);
	next.delete("theme");
	next.set("page", String(page));
	return `?${next.toString()}`;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const ROLE: Record<string, string> = {
	p: "pawn",
	n: "knight",
	b: "bishop",
	r: "rook",
	q: "queen",
	k: "king",
};

/** The static diagram, built as markup the shared stylesheet already paints. */
function boardHtml(fen: string): string {
	const placement = fen.trim().split(/\s+/)[0] ?? "";
	let html = "";
	placement.split("/").forEach((rank, row) => {
		let col = 0;
		const square = (piece: string | null): void => {
			const name = FILES[col]! + RANKS[row]!;
			const light = (row + col) % 2 === 0;
			const inner = piece
				? `<piece class="${piece === piece.toUpperCase() ? "white" : "black"} ${ROLE[piece.toLowerCase()] ?? ""}"></piece>`
				: "";
			html += `<div class="sq ${light ? "sq--l" : "sq--d"}" data-sq="${name}">${inner}</div>`;
			col++;
		};
		for (const ch of rank) {
			if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) square(null);
			else square(ch);
		}
	});
	return `<div class="board">${html}</div>`;
}

function cardHtml(
	p: CatalogueComposition,
	progress?: CatalogueProgress,
	hrefSuffix = "",
): string {
	const who = p.composer
		? `<b>${escapeHtml(p.composer)}</b>`
		: "<i>Anonymous</i>";
	const credit = p.year ? `${who} · ${p.year}` : who;
	const tags = p.difficulty
		? `<p class="card__tags">${escapeHtml(levelLabel(p.difficulty))}</p>`
		: "";
	const state = progress?.get(p.id);
	const cardClass = state ? `card card--${state}` : "card";
	return (
		// The id is letters and digits, so it is unreserved in a path and needs no
		// escaping; it is encoded anyway so that no id shape can ever emit a stray
		// href.
		`<a class="${cardClass}" data-composition-id="${p.id}" href="/compositions/${encodeURIComponent(p.id)}${escapeHtml(hrefSuffix)}">` +
		`<figure class="diagram diagram--thumb">${boardHtml(p.fen)}</figure>` +
		`<div class="card__meta">` +
		`<p class="card__task">${escapeHtml(taskFor(p))}</p>` +
		`<p class="card__credit">${credit}</p>` +
		`${tags}` +
		`</div></a>`
	);
}

function pagerHtml(
	page: number,
	pages: number,
	href: (n: number) => string,
): string {
	if (pages <= 1) return "";

	const items: (number | "gap")[] = [];
	const first = Math.max(1, page - 2);
	const last = Math.min(pages, first + 4);
	if (first > 1) {
		items.push(1);
		if (first > 2) items.push("gap");
	}
	for (let p = first; p <= last; p++) items.push(p);
	if (last < pages) {
		if (last < pages - 1) items.push("gap");
		items.push(pages);
	}

	const link = (n: number, label: string) =>
		`<a href="${escapeHtml(href(n))}">${label}</a>`;
	const out = [page > 1 ? link(page - 1, "&lsaquo;") : "<span>&lsaquo;</span>"];
	for (const item of items) {
		if (item === "gap") out.push('<span class="pager__gap">&hellip;</span>');
		else if (item === page)
			out.push(`<span aria-current="page">${item}</span>`);
		else out.push(link(item, String(item)));
	}
	out.push(page < pages ? link(page + 1, "&rsaquo;") : "<span>&rsaquo;</span>");
	out.push('<span class="pager__spacer"></span>');
	return out.join("");
}

/** A full page of the catalogue: the three elements the list page swaps in. */
export function renderCatalogue(
	list: CatalogueComposition[],
	state: State,
	href: (n: number) => string,
	progress?: CatalogueProgress,
	hrefSuffix = "",
	pageSize = PER_PAGE,
): { cards: string; result: string; pager: string } {
	const pages = Math.max(1, Math.ceil(list.length / pageSize));
	const page = Math.min(Math.max(1, state.page), pages);
	const cards =
		list
			.slice((page - 1) * pageSize, page * pageSize)
			.map((composition) => cardHtml(composition, progress, hrefSuffix))
			.join("") || '<p class="caption">Nothing matches.</p>';
	const result =
		`<span><b>${list.length}</b> composition${list.length === 1 ? "" : "s"}</span>`;
	return { cards, result, pager: pagerHtml(page, pages, href) };
}
