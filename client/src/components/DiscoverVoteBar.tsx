import { Bookmark, HelpCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DownvoteReason, Reaction } from "@/types";

export interface DiscoverVotePayload {
  reaction: Reaction;
  reason?: DownvoteReason;
}

interface DiscoverVoteBarProps {
  disabled?: boolean;
  onVote: (payload: DiscoverVotePayload) => void;
  onWatchlist: () => void;
  onSkip: () => void;
}

/**
 * Four actions, one meaning each:
 *   👎 Not for me      - you know it, and it's a no (strong taste signal)
 *   🤷 Don't know it   - never heard of it; moves on, costs almost nothing
 *   🔖 Want to watch   - haven't seen it, looks good (goes to watchlist)
 *   👍 Liked it        - you watched it and enjoyed it (strong taste signal)
 */
export function DiscoverVoteBar({
  disabled = false,
  onVote,
  onWatchlist,
  onSkip,
}: DiscoverVoteBarProps) {
  const handleDownvoteClick = () => {
    onVote({ reaction: "down", reason: undefined });
  };

  return (
    <div
      className="flex shrink-0 items-start justify-center gap-5 border-t border-border/50 bg-background/80 py-3 backdrop-blur-sm"
      data-testid="discover-vote-bar"
    >
      <div className="flex flex-col items-center gap-1">
        <Button
          type="button"
          variant="destructive"
          size="icon-lg"
          disabled={disabled}
          onClick={handleDownvoteClick}
          aria-label="Not for me: watched it or know it, and it's a no"
          className="shadow-lg shadow-destructive/30 transition-transform active:scale-95"
        >
          <ThumbsDown className="h-6 w-6" />
        </Button>
        <span className="text-[10px] text-muted-foreground">Not for me</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          disabled={disabled}
          onClick={onSkip}
          aria-label="Don't know it: never heard of this, show me the next one"
          className="shadow-lg transition-transform active:scale-95"
          data-testid="skip-button"
        >
          <HelpCircle className="h-6 w-6" />
        </Button>
        <span className="text-[10px] text-muted-foreground">Don&apos;t know it</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="icon-lg"
          disabled={disabled}
          onClick={onWatchlist}
          aria-label="Want to watch: save to watchlist"
          className="shadow-lg transition-transform active:scale-95"
        >
          <Bookmark className="h-6 w-6" />
        </Button>
        <span className="text-[10px] text-muted-foreground">Want to watch</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Button
          type="button"
          variant="success"
          size="icon-lg"
          disabled={disabled}
          onClick={() => onVote({ reaction: "up" })}
          aria-label="Liked it: watched this and enjoyed it"
          className="shadow-lg shadow-success/30 transition-transform active:scale-95"
        >
          <ThumbsUp className="h-6 w-6" />
        </Button>
        <span className="text-[10px] text-muted-foreground">Liked it</span>
      </div>
    </div>
  );
}
