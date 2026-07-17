import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { z } from "zod";
import { toHttpStatus, toUserMessage } from "./api-errors.js";
import {
  addToWatchlist,
  getAnimeDetailPage,
  getNextQueue,
  getProfile,
  getTasteMetrics,
  getTastePatterns,
  getWatchlistEntries,
  rateAnime,
  rateFromDetail,
  getTasteCombos,
  recordEngagementSignal,
  skipAnime,
  updateTasteComboStatus,
  removeFromWatchlist,
  warmDiscoverQueue,
  getWatchStreams,
} from "./service.js";
import { scheduleBulkTasteEnrichment } from "./enrichment.js";
import { DOWNVOTE_REASONS, REACTIONS } from "./types.js";
import { getAnimeById } from "./db.js";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);

function errorResponse(c: Context, error: unknown) {
  return c.json({ error: toUserMessage(error) }, toHttpStatus(error) as any);
}

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/next", async (c) => {
  try {
    const queue = await getNextQueue();
    return c.json({ queue });
  } catch (error) {
    return errorResponse(c, error);
  }
});

const rateSchema = z.object({
  malId: z.number().int().positive(),
  reaction: z.enum(REACTIONS),
  dwellMs: z.number().int().nonnegative().optional(),
  skipped: z.boolean().optional(),
  reason: z.enum(DOWNVOTE_REASONS).optional(),
});

const signalSchema = z.object({
  malId: z.number().int().positive(),
  dwellMs: z.number().int().nonnegative(),
  skipped: z.boolean(),
});

app.post("/api/rate", async (c) => {
  const body: unknown = await c.req.json();
  const parsed = rateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid rating payload" }, 400);
  }

  try {
    const queue = await rateAnime(parsed.data.malId, parsed.data.reaction, {
      dwellMs: parsed.data.dwellMs,
      skipped: parsed.data.skipped,
      reason: parsed.data.reason,
    });
    return c.json({ queue });
  } catch (error) {
    return errorResponse(c, error);
  }
});

const skipSchema = z.object({
  malId: z.number().int().positive(),
  dwellMs: z.number().int().nonnegative().optional(),
});

app.post("/api/skip", async (c) => {
  const body: unknown = await c.req.json();
  const parsed = skipSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid skip payload" }, 400);
  }

  try {
    const queue = await skipAnime(parsed.data.malId, parsed.data.dwellMs ?? 0);
    return c.json({ queue });
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.post("/api/signals", async (c) => {
  const body: unknown = await c.req.json();
  const parsed = signalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid engagement signal payload" }, 400);
  }

  try {
    recordEngagementSignal(parsed.data.malId, parsed.data.dwellMs, parsed.data.skipped);
    return c.json({ ok: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.get("/api/profile", (c) => {
  return c.json(getProfile());
});

const watchlistSchema = z.object({
  malId: z.number().int().positive(),
});

app.get("/api/watchlist", (c) => {
  return c.json({ entries: getWatchlistEntries() });
});

app.post("/api/watchlist", async (c) => {
  const body: unknown = await c.req.json();
  const parsed = watchlistSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid watchlist payload" }, 400);
  }

  try {
    const queue = await addToWatchlist(parsed.data.malId);
    return c.json({ queue });
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.delete("/api/watchlist/:malId", (c) => {
  const malId = Number(c.req.param("malId"));
  if (!Number.isInteger(malId) || malId <= 0) {
    return c.json({ error: "Invalid anime id" }, 400);
  }

  const removed = removeFromWatchlist(malId);
  if (!removed) {
    return c.json({ error: "Title was not on your watchlist" }, 404);
  }

  return c.json({ ok: true });
});

app.get("/api/taste-combos", (c) => {
  try {
    return c.json({ combos: getTasteCombos() });
  } catch (error) {
    return errorResponse(c, error);
  }
});

const comboStatusSchema = z.object({
  features: z.array(z.string().min(1)).min(2).max(3),
  status: z.enum(["confirmed", "rejected"]),
});

app.post("/api/taste-combos", async (c) => {
  const body: unknown = await c.req.json();
  const parsed = comboStatusSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid combo payload" }, 400);
  }

  try {
    const combos = updateTasteComboStatus(parsed.data.features, parsed.data.status);
    return c.json({ combos });
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.get("/api/taste", (c) => {
  return c.json(getTasteMetrics());
});

app.get("/api/taste-patterns", (c) => {
  return c.json(getTastePatterns());
});

app.post("/api/anime/:malId/rate", async (c) => {
  const malId = Number(c.req.param("malId"));
  if (!Number.isInteger(malId) || malId <= 0) {
    return c.json({ error: "Invalid anime id" }, 400);
  }

  const body: unknown = await c.req.json();
  const parsed = z
    .object({
      reaction: z.enum(REACTIONS),
      dwellMs: z.number().int().nonnegative().optional(),
      skipped: z.boolean().optional(),
      reason: z.enum(DOWNVOTE_REASONS).optional(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid rating payload" }, 400);
  }

  try {
    const userReaction = rateFromDetail(malId, parsed.data.reaction, {
      dwellMs: parsed.data.dwellMs,
      skipped: parsed.data.skipped,
      reason: parsed.data.reason,
    });
    const detail = await getAnimeDetailPage(malId);
    return c.json({ userReaction, detail });
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.get("/api/anime/:malId", async (c) => {
  const malId = Number(c.req.param("malId"));
  if (!Number.isInteger(malId) || malId <= 0) {
    return c.json({ error: "Invalid anime id" }, 400);
  }

  try {
    const detail = await getAnimeDetailPage(malId);
    return c.json(detail);
  } catch (error) {
    return errorResponse(c, error);
  }
});
app.get("/api/watch/:malId", async (c) => {
  const malId = Number(c.req.param("malId"));
  if (!Number.isInteger(malId) || malId <= 0) {
    return c.json({ error: "Invalid anime id" }, 400);
  }

  try {
    const payload = await getWatchStreams(malId);
    return c.json(payload);
  } catch (error) {
    console.error(`[watch-api] Failed to resolve watch streams for ID ${malId}:`, error);
    return c.json({ malId, streams: [] });
  }
});

// ── TMDB ID lookup ────────────────────────────────────────────────────────────

const tmdbCache = new Map<number, number | null>();

app.get("/api/tmdb/:malId", async (c) => {
  const malId = Number(c.req.param("malId"));
  if (!Number.isInteger(malId) || malId <= 0) {
    return c.json({ error: "Invalid anime id" }, 400);
  }

  if (tmdbCache.has(malId)) {
    const cached = tmdbCache.get(malId);
    if (cached === null) return c.json({ error: "No TMDB match found for this title" }, 404);
    return c.json({ tmdbId: cached });
  }

  try {
    const row = getAnimeById(malId);
    if (!row) return c.json({ error: "Anime not found in catalog" }, 404);

    let tmdbId: number | null = null;
    const apiKey = process.env.TMDB_API_KEY;

    if (apiKey) {
      const res = await fetch(
        `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(row.title_en)}`
      );
      if (res.ok) {
        const data = await res.json() as { results: Array<{ id: number }> };
        tmdbId = data.results?.[0]?.id ?? null;
      }
    } else {
      // Scrape TMDB website - no API key needed
      const res = await fetch(
        `https://www.themoviedb.org/search/tv?query=${encodeURIComponent(row.title_en)}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html",
          },
        }
      );
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/\/tv\/(\d+)/);
        if (match) tmdbId = Number(match[1]);
      }
    }

    tmdbCache.set(malId, tmdbId);
    if (!tmdbId) return c.json({ error: "No TMDB match found for this title" }, 404);
    return c.json({ tmdbId });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// ── Episodes (Jikan) ──────────────────────────────────────────────────────────

app.get("/api/episodes/:malId", async (c) => {
  const malId = Number(c.req.param("malId"));
  if (!Number.isInteger(malId) || malId <= 0) {
    return c.json({ error: "Invalid anime id" }, 400);
  }
  try {
    const row = getAnimeById(malId);
    if (!row) return c.json({ error: "Anime not found in catalog" }, 404);

    const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=1`);
    if (!res.ok) return c.json({ malId, title: row.title_en, episodes: [] });

    const data = await res.json() as {
      data: Array<{ mal_id: number; title: string | null; title_romanji: string | null }>;
    };

    const episodes = (data.data ?? []).map((ep) => ({
      id: String(ep.mal_id),
      number: ep.mal_id,
      title: ep.title ?? ep.title_romanji ?? null,
    }));

    return c.json({ malId, title: row.title_en, episodes });
  } catch (error) {
    return errorResponse(c, error);
  }
});

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, () => {
  warmDiscoverQueue();
  if (process.env.ANIKINATOR_BULK_ENRICH === "1") {
    const max = Number(process.env.ANIKINATOR_BULK_ENRICH_MAX ?? "24");
    scheduleBulkTasteEnrichment({ maxTitles: Number.isFinite(max) ? max : 24 });
  }
  console.log(`Anikinator API running at http://localhost:${port}`);
});
