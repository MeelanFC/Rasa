import { Bookmark, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DownvoteReason, Reaction } from "@/types";

export interface DetailVotePayload {
  reaction: Reaction;
  reason?: DownvoteReason;
}

interface VoteButtonsProps {
  userReaction: Reaction | null;
  isWatchlisted: boolean;
  disabled?: boolean;
  onVote: (payload: DetailVotePayload) => void;
  onWatchlistToggle: () => void;
}

export function VoteButtons({
  userReaction,
  isWatchlisted,
  disabled = false,
  onVote,
  onWatchlistToggle,
}: VoteButtonsProps) {
  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant={userReaction === "down" ? "destructive" : "outline"}
          size="icon-lg"
          disabled={disabled}
          onClick={() => onVote({ reaction: "down", reason: undefined })}
          aria-label="Thumbs down, not for me"
          aria-pressed={userReaction === "down"}
          className="shadow-lg transition-transform active:scale-95"
        >
          <ThumbsDown className="h-6 w-6" />
        </Button>
        <Button
          type="button"
          variant={isWatchlisted ? "secondary" : "outline"}
          size="icon-lg"
          disabled={disabled}
          onClick={onWatchlistToggle}
          aria-label={
            isWatchlisted
              ? "Remove from watchlist"
              : "Save for later, won't show in Discover again"
          }
          aria-pressed={isWatchlisted}
          className="shadow-lg transition-transform active:scale-95"
        >
          <Bookmark className="h-6 w-6" />
        </Button>
        <Button
          type="button"
          variant={userReaction === "up" ? "success" : "outline"}
          size="icon-lg"
          disabled={disabled}
          onClick={() => onVote({ reaction: "up" })}
          aria-label="Thumbs up, I'd watch this"
          aria-pressed={userReaction === "up"}
          className="shadow-lg transition-transform active:scale-95"
        >
          <ThumbsUp className="h-6 w-6" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {isWatchlisted
          ? "On your watchlist, hidden from Discover"
          : "Watchlist = save for later, won't show in Discover again"}
      </p>
      {userReaction && (
        <p className="text-xs text-muted-foreground">
          You voted {userReaction === "up" ? "up" : "down"}; tap again to change
        </p>
      )}
    </div>
  );
}
