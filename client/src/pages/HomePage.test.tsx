import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as api from "@/api";
import {
  CARD_SETTLE_MS,
  VOTE_INTERACTION_LOCK_MS,
} from "@/hooks/useDiscoverVoteTransition";
import { HomePage } from "./HomePage";
import type { AnimeCard } from "@/types";

const REVEAL_TIMEOUT_MS = VOTE_INTERACTION_LOCK_MS + 150;
// Votes arm 600ms after a card appears (anti-speed-swipe); unlock waits must cover it.
const VOTE_ARM_DELAY_MS = 600;
const UNLOCK_TIMEOUT_MS =
  VOTE_INTERACTION_LOCK_MS + CARD_SETTLE_MS + VOTE_ARM_DELAY_MS + 300;

/** Finds a vote-bar button and waits for the post-reveal arm delay to pass. */
async function findArmedButton(name: RegExp) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).not.toBeDisabled(), {
    timeout: VOTE_ARM_DELAY_MS + 500,
  });
  return button;
}

function createCard(malId: number, title: string, overrides: Partial<AnimeCard> = {}): AnimeCard {
  return {
    malId,
    franchiseKey: title.toLowerCase().replace(/\s+season\s*\d+.*$/i, "").trim(),
    titleEn: title,
    titleRomaji: title,
    synopsis: "synopsis",
    imageUrl: `https://example.com/${malId}.jpg`,
    genres: [],
    themes: [],
    score: null,
    mediaType: "anime",
    chapterCount: null,
    ...overrides,
  };
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HomePage", () => {
  it("renders the first card from the queue", async () => {
    vi.spyOn(api, "fetchNextQueue").mockResolvedValue([
      createCard(1, "Cowboy Bebop"),
      createCard(2, "Trigun"),
    ]);

    renderHome();

    expect(
      await screen.findByRole("heading", { name: "Cowboy Bebop" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Personalized picks/i)).not.toBeInTheDocument();
  });

  it("does not show the same malId twice when server queue has duplicates", async () => {
    vi.spyOn(api, "fetchNextQueue").mockResolvedValue([
      createCard(1, "Cowboy Bebop"),
      createCard(1, "Cowboy Bebop"),
      createCard(2, "Trigun"),
    ]);
    vi.spyOn(api, "submitRating").mockResolvedValue([
      createCard(2, "Trigun"),
      createCard(3, "Berserk"),
    ]);

    renderHome();

    expect(
      await screen.findByRole("heading", { name: "Cowboy Bebop" }),
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(await findArmedButton(/Liked it/i));

    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: "Trigun" })).toBeInTheDocument();
      },
      { timeout: REVEAL_TIMEOUT_MS },
    );
    expect(screen.queryByRole("heading", { name: "Cowboy Bebop" })).not.toBeInTheDocument();
  });

  it("disables vote buttons during the post-vote lock", async () => {
    vi.spyOn(api, "fetchNextQueue").mockResolvedValue([
      createCard(1, "Cowboy Bebop"),
      createCard(2, "Trigun"),
    ]);
    vi.spyOn(api, "submitRating").mockResolvedValue([createCard(2, "Trigun")]);

    const user = userEvent.setup();
    renderHome();

    const upButton = await findArmedButton(/Liked it/i);
    await user.click(upButton);

    expect(upButton).toBeDisabled();
    expect(screen.getByRole("button", { name: /Not for me/i })).toBeDisabled();

    await waitFor(() => expect(upButton).not.toBeDisabled(), {
      timeout: UNLOCK_TIMEOUT_MS,
    });
  });

  it("ignores a second vote click while transitioning", async () => {
    vi.spyOn(api, "fetchNextQueue").mockResolvedValue([
      createCard(1, "Cowboy Bebop"),
      createCard(2, "Trigun"),
    ]);
    const rateSpy = vi.spyOn(api, "submitRating").mockResolvedValue([
      createCard(2, "Trigun"),
    ]);

    renderHome();

    const user = userEvent.setup();
    const upButton = await findArmedButton(/Liked it/i);
    await user.click(upButton);
    expect(upButton).toBeDisabled();
    fireEvent.click(upButton);

    expect(rateSpy).toHaveBeenCalledTimes(1);
    expect(rateSpy).toHaveBeenCalledWith(
      1,
      "up",
      expect.objectContaining({ dwellMs: expect.any(Number) }),
    );
  });

  it("calls submitWatchlist when Save for later is pressed", async () => {
    vi.spyOn(api, "fetchNextQueue").mockResolvedValue([
      createCard(1, "Cowboy Bebop"),
      createCard(2, "Trigun"),
    ]);
    const watchlistSpy = vi
      .spyOn(api, "submitWatchlist")
      .mockResolvedValue([createCard(2, "Trigun")]);

    renderHome();

    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Cowboy Bebop" });
    await user.click(await findArmedButton(/Want to watch/i));

    expect(watchlistSpy).toHaveBeenCalledWith(1);
  });

  it("advances queue optimistically then reveals the next card after lock", async () => {
    vi.spyOn(api, "fetchNextQueue").mockResolvedValue([
      createCard(1, "Cowboy Bebop"),
      createCard(2, "Trigun"),
      createCard(3, "Berserk"),
    ]);
    const rateSpy = vi
      .spyOn(api, "submitRating")
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve([
                  createCard(2, "Trigun"),
                  createCard(3, "Berserk"),
                  createCard(4, "Outlaw Star"),
                ]),
              50,
            ),
          ),
      );

    const user = userEvent.setup();
    renderHome();

    await screen.findByRole("heading", { name: "Cowboy Bebop" });
    await user.click(await findArmedButton(/Liked it/i));

    expect(screen.getByRole("heading", { name: "Cowboy Bebop" })).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: "Trigun" })).toBeInTheDocument();
      },
      { timeout: REVEAL_TIMEOUT_MS },
    );
    await waitFor(() =>
      expect(rateSpy).toHaveBeenCalledWith(
        1,
        "up",
        expect.objectContaining({ dwellMs: expect.any(Number) }),
      ),
    );
  });
});
