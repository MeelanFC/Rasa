import { Bookmark, HeartCrack, ThumbsDown, ThumbsUp } from "lucide-react";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { DownvoteReason, Reaction } from "@/types";

export interface DiscoverVotePayload {
  reaction: Reaction;
  reason?: DownvoteReason;
}

interface DiscoverVoteBarProps {
  disabled?: boolean;
  onVote: (payload: DiscoverVotePayload) => void;
  onWatchlist: () => void;
}

/**
 * Four actions, one meaning each.
 *
 * The swipe itself is decided from the poster and the synopsis alone:
 *   👎 Pass         - wouldn't watch it. Trains as a no.
 *   🔖 Would watch  - looks good. Saved to the watchlist and trains as a yes.
 *
 * The other two are verdicts on titles the user has actually watched:
 *   💔 Dropped      - started it, didn't finish. A strong no, stored as `dropped`.
 *   👍 Liked it     - watched it and enjoyed it. A strong yes.
 *
 * There is deliberately no "don't know it": every card is judged on its
 * poster and synopsis, which is exactly the signal the engine learns from.
 */
export function DiscoverVoteBar({
  disabled = false,
  onVote,
  onWatchlist,
}: DiscoverVoteBarProps) {
  return (
    <div
      className="flex shrink-0 items-start justify-center gap-5 border-t border-border/50 bg-background/80 py-3 backdrop-blur-sm"
      data-testid="discover-vote-bar"
    >
      <VoteAction
        label="Pass"
        ariaLabel="Pass: I would not watch this"
        variant="destructive"
        className="shadow-destructive/30"
        disabled={disabled}
        onClick={() => onVote({ reaction: "down", reason: undefined })}
      >
        <ThumbsDown className="h-6 w-6" />
      </VoteAction>
      <VoteAction
        label="Dropped"
        ariaLabel="Dropped: started watching it and did not finish"
        variant="outline"
        className="border-destructive/40 text-destructive hover:bg-destructive/15"
        disabled={disabled}
        onClick={() => onVote({ reaction: "down", reason: "dropped" })}
        testId="dropped-button"
      >
        <HeartCrack className="h-6 w-6" />
      </VoteAction>
      <VoteAction
        label="Would watch"
        ariaLabel="Would watch: looks good, save it to the watchlist"
        variant="secondary"
        disabled={disabled}
        onClick={onWatchlist}
      >
        <Bookmark className="h-6 w-6" />
      </VoteAction>
      <VoteAction
        label="Liked it"
        ariaLabel="Liked it: watched it and enjoyed it"
        variant="success"
        className="shadow-success/30"
        disabled={disabled}
        onClick={() => onVote({ reaction: "up" })}
      >
        <ThumbsUp className="h-6 w-6" />
      </VoteAction>
    </div>
  );
}

interface VoteActionProps {
  label: string;
  ariaLabel: string;
  variant: ButtonProps["variant"];
  className?: string;
  disabled: boolean;
  onClick: () => void;
  testId?: string;
  children: ReactNode;
}

function VoteAction({
  label,
  ariaLabel,
  variant,
  className,
  disabled,
  onClick,
  testId,
  children,
}: VoteActionProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        type="button"
        variant={variant}
        size="icon-lg"
        disabled={disabled}
        onClick={onClick}
        aria-label={ariaLabel}
        className={`shadow-lg transition-transform active:scale-95 ${className ?? ""}`}
        data-testid={testId}
      >
        {children}
      </Button>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
