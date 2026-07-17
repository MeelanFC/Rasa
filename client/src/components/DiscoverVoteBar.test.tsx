import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiscoverVoteBar } from "./DiscoverVoteBar";

describe("DiscoverVoteBar", () => {
  it("calls onWatchlist when the bookmark is pressed", () => {
    const onWatchlist = vi.fn();
    render(
      <DiscoverVoteBar onVote={vi.fn()} onWatchlist={onWatchlist} onSkip={vi.fn()} />,
    );

    screen.getByRole("button", { name: /Want to watch/i }).click();
    expect(onWatchlist).toHaveBeenCalledTimes(1);
  });

  it("calls onVote immediately with down reaction and no reason after thumbs down", async () => {
    const onVote = vi.fn();
    const user = userEvent.setup();

    render(<DiscoverVoteBar onVote={onVote} onWatchlist={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Not for me/i }));
    expect(onVote).toHaveBeenCalledWith({ reaction: "down", reason: undefined });
  });

  it("calls onSkip when Don't know it is pressed, without voting", async () => {
    const onSkip = vi.fn();
    const onVote = vi.fn();
    const user = userEvent.setup();

    render(<DiscoverVoteBar onVote={onVote} onWatchlist={vi.fn()} onSkip={onSkip} />);

    await user.click(screen.getByRole("button", { name: /Don't know it/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onVote).not.toHaveBeenCalled();
  });

  it("labels all four actions", () => {
    render(<DiscoverVoteBar onVote={vi.fn()} onWatchlist={vi.fn()} onSkip={vi.fn()} />);

    expect(screen.getByText("Not for me")).toBeInTheDocument();
    expect(screen.getByText("Don't know it")).toBeInTheDocument();
    expect(screen.getByText("Want to watch")).toBeInTheDocument();
    expect(screen.getByText("Liked it")).toBeInTheDocument();
  });
});
