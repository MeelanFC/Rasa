import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles, X } from "lucide-react";
import { fetchTasteCombos, updateTasteCombo } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TasteCombo } from "@/types";

/**
 * Mined taste rules ("directed by X, starring Y") the user confirms or
 * rejects. Confirmed rules boost matching titles in every ranking.
 */
export function TasteRules() {
  const queryClient = useQueryClient();
  const combosQuery = useQuery({
    queryKey: ["taste-combos"],
    queryFn: fetchTasteCombos,
  });

  const statusMutation = useMutation({
    mutationFn: ({ combo, status }: { combo: TasteCombo; status: "confirmed" | "rejected" }) =>
      updateTasteCombo(combo.features, status),
    onSuccess: (combos) => {
      queryClient.setQueryData(["taste-combos"], combos);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  const combos = combosQuery.data ?? [];
  const visible = combos.filter((combo) => combo.status !== "rejected");
  if (combosQuery.isLoading || visible.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <Sparkles className="h-4 w-4" />
        Taste rules: do these sound like you?
      </h3>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Found in your liked titles. Confirming a rule boosts everything that
            matches it.
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 p-3 pt-0">
          {visible.map((combo) => (
            <div
              key={combo.key}
              className="flex items-center gap-3 rounded-md border border-border/50 p-3"
              data-testid="taste-rule"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium first-letter:uppercase">{combo.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {combo.likeCount > 0
                    ? `You liked ${combo.likeCount} of these${combo.downCount > 0 ? `, disliked ${combo.downCount}` : ""}, like ${combo.evidence.slice(0, 3).join(", ")}`
                    : "Confirmed rule"}
                </p>
                {combo.matchingUnrated > 0 && (
                  <p className="mt-0.5 text-xs font-medium text-primary">
                    {combo.matchingUnrated} unwatched{" "}
                    {combo.matchingUnrated === 1 ? "title matches" : "titles match"} this
                    {combo.status === "confirmed" ? " and got boosted" : ""}
                  </p>
                )}
              </div>
              {combo.status === "confirmed" ? (
                <Badge variant="success" className="shrink-0 gap-1">
                  <Check className="h-3 w-3" />
                  My taste
                </Badge>
              ) : (
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="success"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ combo, status: "confirmed" })}
                    aria-label={`Confirm: ${combo.label}`}
                  >
                    <Check className="h-4 w-4" />
                    That&apos;s me
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ combo, status: "rejected" })}
                    aria-label={`Reject: ${combo.label}`}
                  >
                    <X className="h-4 w-4" />
                    Not really
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
