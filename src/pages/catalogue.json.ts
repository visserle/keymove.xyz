import type { APIRoute } from "astro";
import { getCatalogue } from "../lib/build-corpus";

export const prerender = true;

/** The public catalogue (no solution notation) as a static asset for catalogue
 * clients. Served from the artefact `npm run db:import:pgn` writes, which the build
 * has regenerated from data/pgn/. */
export const GET: APIRoute = () => Response.json(getCatalogue());
