import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    // Optional meta description; without one the post page falls back to a
    // generic sentence built from the title.
    description: z.string().optional(),
    author: z.string(),
    pubDate: z.coerce.date(),
  }),
});

export const collections = { blog };
