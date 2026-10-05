import type {
  AnimeCard,
  AnimeDetail,
  DownvoteReason,
  EpisodesResponse,
  ProfileData,
  Reaction,
  TasteCombo,
  WatchlistEntry,
  WatchStreamsResponse,
} from "./types";

export interface SubmitRatingOptions {
  dwellMs?: number;
  skipped?: boolean;
  reason?: DownvoteReason;
}

function formatHttpError(status: number, serverMessage?: string): string {
  if (
    serverMessage &&
    serverMessage.length > 0 &&
    !serverMessage.startsWith("Request failed")
  ) {
    return serverMessage;
  }

  if (status === 502 || status === 503 || status === 504) {
    return "Our servers are busy right now. Wait a moment and try again.";
  }

  if (status === 409) {
    return (
      serverMessage ??
      "This title is still loading. Wait a moment and try again."
    );
  }

  if (status >= 500) {
    return "Something went wrong on our side. Please try again shortly.";
  }

  return serverMessage ?? `Something went wrong (${status}).`;
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  let payload: unknown = null;
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const serverMessage =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : undefined;
    throw new Error(formatHttpError(response.status, serverMessage));
  }

  if (payload === null) {
    throw new Error("Empty response from server; try again in a moment.");
  }

  return payload as T;
}

export async function fetchNextQueue(): Promise<AnimeCard[]> {
  const response = await fetch("/api/next");
  const { queue } = await parseJson<{ queue: AnimeCard[] }>(response);
  return queue;
}

export async function submitRating(
  malId: number,
  reaction: Reaction,
  options: SubmitRatingOptions = {},
): Promise<AnimeCard[]> {
  const response = await fetch("/api/rate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ malId, reaction, ...options }),
  });
  const { queue } = await parseJson<{ queue: AnimeCard[] }>(response);
  return queue;
}

export async function submitEngagementSignal(
  malId: number,
  dwellMs: number,
  skipped: boolean,
): Promise<void> {
  const response = await fetch("/api/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ malId, dwellMs, skipped }),
  });
  await parseJson<{ ok: boolean }>(response);
}

export async function fetchProfile(): Promise<ProfileData> {
  const response = await fetch("/api/profile");
  return parseJson<ProfileData>(response);
}

export async function fetchAnimeDetail(malId: number): Promise<AnimeDetail> {
  const response = await fetch(`/api/anime/${malId}`);
  return parseJson<AnimeDetail>(response);
}

export async function submitDetailRating(
  malId: number,
  reaction: Reaction,
  options: SubmitRatingOptions = {},
): Promise<{ userReaction: Reaction; detail: AnimeDetail }> {
  const response = await fetch(`/api/anime/${malId}/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reaction, ...options }),
  });
  return parseJson<{ userReaction: Reaction; detail: AnimeDetail }>(response);
}

export async function submitWatchlist(malId: number): Promise<AnimeCard[]> {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ malId }),
  });
  const { queue } = await parseJson<{ queue: AnimeCard[] }>(response);
  return queue;
}

export async function removeFromWatchlist(malId: number): Promise<void> {
  const response = await fetch(`/api/watchlist/${malId}`, { method: "DELETE" });
  await parseJson<{ ok: boolean }>(response);
}

export async function fetchWatchlist(): Promise<WatchlistEntry[]> {
  const response = await fetch("/api/watchlist");
  const { entries } = await parseJson<{ entries: WatchlistEntry[] }>(response);
  return entries;
}

export async function fetchEpisodes(malId: number): Promise<EpisodesResponse> {
  const response = await fetch(`/api/episodes/${malId}`);
  return parseJson<EpisodesResponse>(response);
}

export async function fetchTmdbId(malId: number): Promise<{ tmdbId: number }> {
  const response = await fetch(`/api/tmdb/${malId}`);
  return parseJson<{ tmdbId: number }>(response);
}

export async function fetchWatchStreams(malId: number): Promise<WatchStreamsResponse> {
  const response = await fetch(`/api/watch/${malId}`);
  return parseJson<WatchStreamsResponse>(response);
}

export async function fetchTasteCombos(): Promise<TasteCombo[]> {
  const response = await fetch("/api/taste-combos");
  const { combos } = await parseJson<{ combos: TasteCombo[] }>(response);
  return combos;
}

export async function updateTasteCombo(
  features: string[],
  status: "confirmed" | "rejected",
): Promise<TasteCombo[]> {
  const response = await fetch("/api/taste-combos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ features, status }),
  });
  const { combos } = await parseJson<{ combos: TasteCombo[] }>(response);
  return combos;
}

