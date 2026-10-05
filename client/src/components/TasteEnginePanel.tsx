import { Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTasteFeature } from "@/utils/formatTasteFeature";
import type { TasteMetrics } from "@/types";

interface TasteEnginePanelProps {
  taste: TasteMetrics;
}

export function TasteEnginePanel({ taste }: TasteEnginePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          How your picks get smarter
        </CardTitle>
        <CardDescription>
          Every swipe trains the model: Pass and Would watch from the deck, Liked
          it and Dropped as verdicts. After {taste.coldStartThreshold} swipes, picks
          switch from learning to personalized.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Vote weights</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li className="flex items-center justify-between">
                <span>Thumbs up</span>
                <strong className="text-success">
                  +{taste.reactionWeights.up}
                </strong>
              </li>
              <li className="flex items-center justify-between">
                <span>Thumbs down</span>
                <strong className="text-destructive">
                  {taste.reactionWeights.down}
                </strong>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Signals tracked</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {taste.signals.map((signal) => (
                <li key={signal}>· {signal}</li>
              ))}
            </ul>
          </div>
        </div>

        {taste.patterns &&
          (taste.patterns.upLeaning.length > 0 || taste.patterns.downLeaning.length > 0) && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Up vs down patterns</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-success">You tend to upvote</p>
                  <div className="flex flex-wrap gap-1">
                    {taste.patterns.upLeaning.slice(0, 6).map((feature) => (
                      <Badge key={feature.name} variant="success">
                        {formatTasteFeature(feature.name)}
                        <span className="opacity-70">
                          {Math.round(feature.upRate * 100)}%
                        </span>
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-destructive">You tend to downvote</p>
                  <div className="flex flex-wrap gap-1">
                    {taste.patterns.downLeaning.slice(0, 6).map((feature) => (
                      <Badge key={feature.name} variant="destructive">
                        {formatTasteFeature(feature.name)}
                        <span className="opacity-70">
                          {Math.round((1 - feature.upRate) * 100)}%
                        </span>
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        <div>
          <h3 className="mb-2 text-sm font-semibold">Strongest leanings</h3>
          {taste.topFeatures.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Vote on Discover to build your profile.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {taste.topFeatures.map((feature) => (
                <Badge
                  key={feature.name}
                  variant={feature.weight >= 0 ? "success" : "destructive"}
                  className={cn("gap-1.5")}
                >
                  {formatTasteFeature(feature.name)}
                  <span className="opacity-70">
                    {feature.weight > 0
                      ? `+${Math.round(feature.weight * 10) / 10}`
                      : Math.round(feature.weight * 10) / 10}
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <details className="group rounded-md border border-border bg-muted/30 p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-foreground">
            Engine strategy
          </summary>
          <ul className="mt-3 space-y-1.5 text-muted-foreground">
            <li>· {taste.strategy.coldStart}</li>
            <li>· {taste.strategy.exploitation}</li>
            <li>· {taste.strategy.exploration}</li>
            <li>· {taste.strategy.lovedBoost}</li>
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}

