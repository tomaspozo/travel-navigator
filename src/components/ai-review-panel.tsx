import { AlertTriangle, CheckCircle2, Sparkles, XCircle } from "lucide-react";

import {
  AI_CHECK_KEYS,
  AI_CHECK_LABELS,
  type AiReview,
} from "@/lib/ai-review-types";

export function AiReviewPanel({
  review,
  title = "AI review",
}: {
  review: AiReview;
  title?: string;
}) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <ul className="space-y-4">
        {AI_CHECK_KEYS.map((key) => {
          const check = review[key];
          const Icon =
            check.status === "pass"
              ? CheckCircle2
              : check.status === "warn"
                ? AlertTriangle
                : XCircle;
          const tone =
            check.status === "pass"
              ? "text-primary"
              : check.status === "warn"
                ? "text-amber-600 dark:text-amber-400"
                : "text-destructive";
          return (
            <li key={key} className="flex gap-3">
              <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
              <div className="space-y-1">
                <p className="text-sm font-medium">{AI_CHECK_LABELS[key]}</p>
                <p className="text-sm text-muted-foreground">{check.summary}</p>
                {check.status !== "pass" && check.suggestion && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Suggestion: </span>
                    {check.suggestion}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
