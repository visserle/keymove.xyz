// Rewrite data/pgn/index.txt from the files on disk.
//
//   npm run pgn:index             # dry run
//   npm run pgn:index -- --apply  # write the listing
//
// A composer whose file is renamed or merged is still listed under the old name
// until this runs, so run it by hand after any rename or merge in data/pgn/.

import path from "node:path";
import { syncCorpusIndex } from "./pgn";

const APPLY = process.argv.includes("--apply");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (unknownArgs.length)
	throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);

const pgnDir = path.resolve("data/pgn");
if (!APPLY) {
	console.log("dry run: rewrite data/pgn/index.txt from the files on disk");
	console.log("  pass --apply to write");
} else {
	const result = syncCorpusIndex(pgnDir);
	console.log(`done: index ${result.changed ? "rewritten" : "already in step"}`);
	for (const name of result.added) console.log(`  + ${name}`);
	for (const name of result.removed) console.log(`  - ${name}`);
}
