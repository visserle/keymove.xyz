# The lichess port

The solving screen is a port of lila's analysis board. This file records what was taken from where, and the handful of places where keymove deliberately parts ways.

Read [lila's source](https://github.com/lichess-org/lila) alongside this. Every path below is relative to that repository.

## The solving island

`Solve.svelte` ports lila's analysis board instead of replacing it.

| Piece                                               | lila                                                        |
|-----------------------------------------------------|-------------------------------------------------------------|
| Move list, inline and column layouts                | `ui/analyse/src/treeView/`                                  |
| Move-list context menu (right-click, or long press) | `ui/analyse/src/treeView/contextMenu.ts`                    |
| Fork row                                            | `ui/analyse/src/fork.ts`, `ui/analyse/css/_fork.scss`       |
| Control bar under the board                         | `ui/analyse/src/view/controls.ts`, `css/_tools-mobile.scss` |
| Resize grip                                         | `lib/chessgroundResize.ts`                                  |
| Jump navigation and hold-to-repeat                  | `ui/lib/src/pointer.ts`                                     |
| Annotation glyphs                                   | `ui/lib/src/game/glyphs.ts`                                 |
| Icons                                               | `ui/lib/src/licon.ts`                                       |

The context menu keeps the hold gesture and drops lila's double tap. WebKit delivers `dblclick` for mouse only. On touch, the first tap of a pair navigates and reflows the list, so the second tap selects a different move.

The renderer prints the move list as a string, then paints lila's `active`, context-menu and pending-deletion classes onto the existing `<move>` elements. That keeps a tap from re-rendering the tree and shifting the move out from under the finger.

### The move box and resize grip read chessground's size

Chessground renders into its own `cg-container`, rounded down to whole 8-device-pixel squares. The `.cg-wrap` wrapper holds the requested size and can run up to 7px larger. Anything that lines up with the board therefore reads chessground's own measurement:

- **The move box** takes `height: var(---cg-height, …)`. Chessground publishes the rounded size as `---cg-width` and `---cg-height`. `Solve.svelte` points that at `<body>`, as lila does in `ui/analyse/src/ground.ts`.
- **The resize grip** is appended into `cg-container` through chessground's `events.insert` hook, so it measures from the board's real corner. Lila does this in `lib/chessgroundResize.ts`. The drag clamps `---zoom` to `0..100`, where `100` is the board scale `--sq` already fitted to the page. A board nobody has resized opens at `DEFAULT_BOARD_ZOOM` (`lib/preferences.ts`, mirrored as `--board-zoom` in `styles/tokens.css` for the first paint) rather than at that 100: lila's fitted board fills the viewport, and here a first visit opens a shade under the home page's board instead, which is 85% of the fit.

### The key field shares the tab strip

Before the key, the strip is split in half: Analysis on the left, the one-move field in the half Solution will take. Both halves are `flex: 0 0 50%`, so the divider stays put when the field becomes the Solution tab. The submit button is the keymark itself. The strip is lila's fixed 44px engine-bar box (`ui/analyse/css/_tools.scss`), which is where the move list starts on lila's line.

The verdict, not the page load, returns the solution. `POST /api/key` reads it from `composition_solution` and returns it on a correct guess. A later page request includes it only after that user's progress says solved. The browser replays the notation with chessops to build the tree.

Saved Analysis trees are re-validated and replayed server-side before restore, because FENs and paths inside a snapshot are user-supplied data.

## Ported page surfaces

| Surface                               | lila                                                         |
|---------------------------------------|--------------------------------------------------------------|
| Board coordinates, inside and outside | `ui/lib/css/theme/board/_coords-in.scss`, `_coords.scss`     |
| Topbar and its scroll behaviour       | `ui/lib/css/header/`, `ui/site/src/topBar.ts`                |
| Hamburger drawer                      | `ui/lib/css/header/_topnav-hidden.scss`                      |
| Dasher (the gear panel)               | `ui/dasher/`                                                 |
| Piece geometry                        | `ui/dasher/css/_piece.scss`, `ui/lib/css/theme/_pieces.scss` |
| Board paint knobs                     | `ui/dasher/src/board.ts`                                     |
| Sound                                 | `ui/site/src/sound.ts`, `ui/dasher/src/sound.ts`             |
| Touch handling                        | `ui/lib/src/pointer.ts`, `ui/lib/css/abstract/_extends.scss` |
| Column breakpoints                    | `ui/lib/css/abstract/_media-queries.scss`                    |

Two conventions run through all of it. Sound is a single volume preference whose zero is mute, so lila's separate on/off switch folds into the slider. The checkerboard sits on a `::before` layer, because filtering `cg-board` itself would recolour the pieces standing on it.

Piece sets stay behind `styles/pieces.css` and `board/piecesets.ts`. Adding a set is twelve SVGs in `src/assets/piece/<id>/` and one line in `REGISTRY`. The stylesheet paints every piece from a custom property, so it never names a file.

## Where this differs from lila

Each of these is settled. A port of a newer lila keeps them:

- The settings button sits with the jump buttons rather than in the tool row below.
- The Analysis and Solution tabs sit inside the move box, styled as that tool row.
- The topbar tab marks the current section with hover fill alone. `aria-current` stays in the markup for assistive tech.
- The stuck topbar repeats the page gradient instead of taking a fill colour, so it reads as a continuation of the page. Its bottom shadow is dropped too, because a bar that scrolls away has nothing to lift off content.

## Credits

The board is `@lichess-org/chessground` (GPL-3.0-or-later) and the rules come from [`chessops`](https://github.com/niklasf/chessops) (GPL-3.0-or-later) — both maintained by lichess, and both used by lila itself.

The two typefaces in `public/fonts/` and the sound effects in `public/sound/` are lila's, used under the same AGPL-3.0-or-later terms as the rest of this port.