import type { CostSummary } from "@/lib/costs";
import { exceedsDemoBudget } from "@/lib/costs";

const STAP_LABELS: Record<string, string> = {
  research: "Research",
  generatie: "Generatie",
  review: "Review",
  chat_edit: "Chat-edit",
};

export function CostSummaryView({ summary }: { summary: CostSummary }) {
  if (summary.totalEur === 0) {
    return null;
  }

  return (
    <section className="mt-6 space-y-2 text-sm">
      <h3 className="font-medium text-neutral-700">Kosten (3.9 / 13)</h3>
      <p className={exceedsDemoBudget(summary) ? "font-medium text-red-600" : "text-neutral-600"}>
        Totaal: €{summary.totalEur.toFixed(2)}
        {exceedsDemoBudget(summary) ? " — boven het richtbudget van €5 per demo" : ""}
      </p>
      <ul className="space-y-0.5 text-neutral-600">
        {Object.entries(summary.byStap).map(([stap, bedrag]) => (
          <li key={stap}>
            {STAP_LABELS[stap] ?? stap}: €{bedrag.toFixed(2)}
          </li>
        ))}
      </ul>
    </section>
  );
}
