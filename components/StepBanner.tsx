/**
 * The one place a student looks to learn what to do next.
 *
 * Filled, high-contrast and always at the top of a tool, so the current
 * step is never in doubt. `tone` colours it: blue while setting up, red
 * with a pulsing dot while recording, green when a run is complete.
 */
type Props = {
  step: string;
  instruction: string;
  tone?: "info" | "live" | "done";
  hint?: string;
};

const TONE: Record<NonNullable<Props["tone"]>, string> = {
  info: "bg-[var(--series-1)]",
  live: "bg-[var(--critical)]",
  done: "bg-[var(--series-3)]",
};

export default function StepBanner({
  step,
  instruction,
  tone = "info",
  hint,
}: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="step-banner"
      data-tone={tone}
      className={`flex items-start gap-3 rounded-xl px-4 py-3 text-white ${TONE[tone]}`}
    >
      {tone === "live" && (
        <span
          aria-hidden
          className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-white"
        />
      )}
      <div className="min-w-0">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-white/85">
          {step}
        </p>
        <p className="text-[15px] font-medium leading-snug">{instruction}</p>
        {hint && (
          <p className="mt-0.5 text-[12px] leading-snug text-white/75">{hint}</p>
        )}
      </div>
    </div>
  );
}
