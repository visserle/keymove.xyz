/**
 * Lichess's icon-font glyphs, ported from `lichess-org/lila`'s
 * `ui/lib/src/licon.ts`. Each value is a private-use codepoint served by
 * `public/fonts/lichess.woff2`; `[data-icon]::before` in `app.css` renders it
 * with the `lichess` font, exactly as lila does.
 */
export const licon = {
	Gear: "\ue005",
	Checkmark: "\ue023",
	InternalArrow: "\ue024",
	GreaterThan: "\ue026",
	LessThan: "\ue027",
	X: "\ue02a",
	UpTriangle: "\ue031",
	JumpLast: "\ue034",
	JumpFirst: "\ue035",
	Hamburger: "\ue039",
	Trash: "\ue04f",
} as const;

