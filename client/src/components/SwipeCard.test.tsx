import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SwipeCard } from "./SwipeCard";

describe("SwipeCard", () => {
  const sampleAnime = {
    malId: 31043,
    titleEn: "Erased",
    titleRomaji: "Boku dake ga Inai Machi",
    synopsis: "A man travels back in time.",
    imageUrl: "https://example.com/erased.jpg",
    genres: ["Mystery", "Supernatural"],
    themes: [],
    score: 8.51,
    mediaType: "anime" as const,
    chapterCount: null,
  };

  const sampleManhwa = {
    ...sampleAnime,
    malId: 800_000_001,
    titleEn: "Solo Leveling",
    titleRomaji: "Na Honjaman Level Up",
    mediaType: "manhwa" as const,
    chapterCount: 200,
  };

  it("renders poster, titles, synopsis, genre badges and vote buttons", () => {
    render(<SwipeCard anime={sampleAnime} onReact={vi.fn()} />);

    const poster = screen.getByRole("img", { name: "Erased" });
    expect(poster).toHaveAttribute("src", "https://example.com/erased.jpg");
    expect(screen.getByRole("heading", { name: "Erased" })).toBeInTheDocument();
    expect(screen.getByText("Boku dake ga Inai Machi")).toBeInTheDocument();
    expect(screen.getByText(/travels back in time/i)).toBeInTheDocument();
    expect(screen.getByText("Mystery")).toBeInTheDocument();
    expect(screen.getByText("Supernatural")).toBeInTheDocument();
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thumbs up/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thumbs down/i })).toBeInTheDocument();
  });

  it("shows top-billed cast when provided and hides the line when absent", () => {
    render(
      <SwipeCard
        anime={{ ...sampleAnime, cast: ["Satoru Fujinuma", "Kayo Hinazuki"] }}
        onReact={vi.fn()}
      />,
    );
    expect(screen.getByText(/Satoru Fujinuma, Kayo Hinazuki/)).toBeInTheDocument();

    render(<SwipeCard anime={{ ...sampleAnime, malId: 2 }} onReact={vi.fn()} />);
    expect(screen.getAllByText(/Starring:/)).toHaveLength(1);
  });

  it("shows chapter count for manhwa", () => {
    render(<SwipeCard anime={sampleManhwa} onReact={vi.fn()} />);
    expect(screen.getByText("200 chapters available")).toBeInTheDocument();
  });

  it("hides vote buttons when showVoteButtons is false", () => {
    render(<SwipeCard anime={sampleAnime} showVoteButtons={false} onReact={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Thumbs up/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thumbs down/i })).not.toBeInTheDocument();
  });

  it("calls onReact with the right reaction when buttons are clicked", () => {
    const onReact = vi.fn();
    render(<SwipeCard anime={sampleAnime} onReact={onReact} />);

    screen.getByRole("button", { name: /Thumbs up/i }).click();
    screen.getByRole("button", { name: /Thumbs down/i }).click();

    expect(onReact).toHaveBeenNthCalledWith(1, "up");
    expect(onReact).toHaveBeenNthCalledWith(2, "down");
  });
});
