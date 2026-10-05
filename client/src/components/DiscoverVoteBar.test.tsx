import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiscoverVoteBar } from "./DiscoverVoteBar";

describe("DiscoverVoteBar", () => {
  it("calls onWatchlist when Would watch is pressed, without voting", async () => {
    const onWatchlist = vi.fn();
    const onVote = vi.fn();
    const user = userEvent.setup();

    render(<DiscoverVoteBar onVote={onVote} onWatchlist={onWatchlist} />);

    await user.click(screen.getByRole("button", { name: /Would watch/i }));
    expect(onWatchlist).toHaveBeenCalledTimes(1);
    expect(onVote).not.toHaveBeenCalled();
  });

  it("calls onVote with a plain down reaction for Pass", async () => {
    const onVote = vi.fn();
    const user = userEvent.setup();

    render(<DiscoverVoteBar onVote={onVote} onWatchlist={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^Pass/i }));
    expect(onVote).toHaveBeenCalledWith({ reaction: "down", reason: undefined });
  });

  it("calls onVote with the dropped reason for Dropped", async () => {
    const onVote = vi.fn();
    const onWatchlist = vi.fn();
    const user = userEvent.setup();

    render(<DiscoverVoteBar onVote={onVote} onWatchlist={onWatchlist} />);

    await user.click(screen.getByRole("button", { name: /Dropped/i }));
    expect(onVote).toHaveBeenCalledWith({ reaction: "down", reason: "dropped" });
    expect(onWatchlist).not.toHaveBeenCalled();
  });

  it("calls onVote with up for Liked it", async () => {
    const onVote = vi.fn();
    const user = userEvent.setup();

    render(<DiscoverVoteBar onVote={onVote} onWatchlist={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Liked it/i }));
    expect(onVote).toHaveBeenCalledWith({ reaction: "up" });
  });

  it("disables every action together", () => {
    render(<DiscoverVoteBar disabled onVote={vi.fn()} onWatchlist={vi.fn()} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("labels all four actions", () => {
    render(<DiscoverVoteBar onVote={vi.fn()} onWatchlist={vi.fn()} />);

    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Dropped")).toBeInTheDocument();
    expect(screen.getByText("Would watch")).toBeInTheDocument();
    expect(screen.getByText("Liked it")).toBeInTheDocument();
  });
});
