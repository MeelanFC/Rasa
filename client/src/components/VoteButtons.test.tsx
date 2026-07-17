import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoteButtons } from "./VoteButtons";

describe("VoteButtons", () => {
  it("calls onVote and highlights the active reaction", () => {
    const onVote = vi.fn();
    const { rerender } = render(
      <VoteButtons
        userReaction={null}
        isWatchlisted={false}
        onVote={onVote}
        onWatchlistToggle={vi.fn()}
      />,
    );

    screen.getByRole("button", { name: /Thumbs up/i }).click();
    expect(onVote).toHaveBeenCalledWith({ reaction: "up" });

    rerender(
      <VoteButtons
        userReaction="up"
        isWatchlisted={false}
        onVote={onVote}
        onWatchlistToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Thumbs up/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onVote with down reaction immediately when thumbs down is clicked", () => {
    const onVote = vi.fn();
    render(
      <VoteButtons
        userReaction={null}
        isWatchlisted={false}
        onVote={onVote}
        onWatchlistToggle={vi.fn()}
      />,
    );

    screen.getByRole("button", { name: /Thumbs down/i }).click();
    expect(onVote).toHaveBeenCalledWith({ reaction: "down", reason: undefined });
  });
});
