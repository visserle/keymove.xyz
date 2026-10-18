import type { APIRoute } from "astro";
import { getAuth } from "../../../lib/auth/runtime";

export const prerender = false;

/** Better Auth's handler for OAuth, sessions, sign-out, and account deletion. */
export const ALL: APIRoute = ({ request }) => getAuth().handler(request);
