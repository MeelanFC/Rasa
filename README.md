# Rasa - Recommendation Engine

Rasa answers one question: what should I watch next?

It learns your taste from one-tap swipes across anime, films, TV shows, and
manhwa. Instead of stopping at "you liked X, here is X 2", it digs for the
combinations behind your taste, like a director plus lead actor plus writer
that keep showing up in things you love, and asks you to confirm them in
plain English.

## How it works

**One tap, one meaning.** You judge every card from its poster and synopsis,
so the two swipe buttons ask exactly that question. The other two record
verdicts on titles you have actually watched:

| Button | Meaning | Signal |
|---|---|---|
| Pass | looked at it, would not watch it | negative |
| Would watch | looks good, goes to the watchlist | positive, a little below a liked verdict |
| Dropped | started it, did not finish | strong negative, kept as its own verdict |
| Liked it | watched it and enjoyed it | strong positive |

Vote buttons arm about 600 ms after each card appears, which is just enough
friction to stop mindless speed-swiping. There is no neutral "don't know it":
a title you have never heard of is judged on its poster and synopsis like any
other, and that judgement is the signal the engine is built to learn from.

**The watchlist is the answer.** The swipe deck teaches the engine; the
watchlist is what you actually watch tonight. When you finish something from
it, a one-tap verdict records the best label a recommender can get, a real
watched-and-judged rating, and clears the entry.

**A learned model, not hand-tuned rules.** Ranking is a logistic regression
trained on your own swipes (Pass, Would watch, Dropped, Liked it), over tag
features plus synopsis tokens, so it can tell plot-driven comedies from cozy
slice-of-life even when the tags match. It takes over after 10 swipes, once it
has seen both yeses and noes; until then an information-gain picker explores,
favouring titles you are likely to recognise. The match percent is a
calibrated probability, not decoration.

**Catalog grows from your taste outward.** A recommender can only recommend
what it has fetched. Every liked film or show pulls the filmographies of its
director, writers, and top cast into the candidate pool, in the background,
so the shelf fills with plausible next watches instead of trending charts.

**Combo mining.** Frequent-itemset mining over the credits of liked titles
finds conjunctions, like a specific director and writer pair with seven likes
and zero dislikes. Support is counted per franchise so five liked seasons of
one show count once. Each rule is shown with its evidence for a one-tap
confirm or reject, and confirmed rules boost every matching unwatched title.

**Composition beats raw ranking.** A single global top list collapses into
whichever cluster is loudest. The grid is composed with media-type quotas
matching your yes mix (Liked it plus Would watch). The deck rolls each card's
media type by how often you say yes to that type, with a prior that keeps every
type alive: a type you keep passing on fades, a type you have not seen yet
still gets shown. Each franchise is represented by its best-known entry, and
franchises you have already rated are excluded outright.

**Everything is measured.** `npm run evaluate -w server` trains on your
earlier swipes (votes and saves), holds out the latest, and reports precision,
ranking, and calibration metrics against the production scoring path.

## Stack

- Server: Node, Hono, SQLite (better-sqlite3), TypeScript, vitest. No ORM and
  no external ML service; the model trains in-process in milliseconds.
- Client: React, Vite, Tailwind, shadcn/ui, TanStack Query, vitest.

## Data sources and API keys

| Provider | Used for | Key needed |
|---|---|---|
| [TMDB](https://www.themoviedb.org/settings/api) | films and TV metadata, credits, posters | Yes, free. Create an account, request an API key, copy the read access token |
| [Jikan](https://jikan.moe) (MyAnimeList) | anime catalog and metadata | No |
| [AniList](https://anilist.co) | anime tags, relations, recommendations | No |
| [MangaDex](https://api.mangadex.org) | manhwa catalog | No |

## Getting started

```bash
# 1. Install (Node 22.9 or newer)
npm install

# 2. Optional: a TMDB key adds films and TV. Anime and manhwa work without one.
#    Windows (PowerShell or cmd):
copy server\.env.example server\.env
#    macOS / Linux:
cp server/.env.example server/.env
# paste your TMDB read token into server/.env

# 3. Run (server on :3001, client on :5173)
npm run dev
```

Open http://localhost:5173 and start swiping. The catalog seeds itself in the
background and the deck never waits on a network call.

The SQLite database lives at `server/data/` and is gitignored; your taste
history stays on your machine. Useful scripts:

```bash
npm run test                   # both workspaces
npm run evaluate -w server     # offline ranking evaluation on your own votes
HOLDOUT=80 npm run evaluate -w server
```

## Privacy

Everything is local: your votes, your database, your model. No accounts, no
telemetry, no cloud calls except the public catalog APIs listed above.

## License

MIT.
