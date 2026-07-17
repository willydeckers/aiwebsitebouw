import type { LeadStatus } from "@/lib/types";
import { LEAD_STATUS_LABELS } from "@/lib/types";

const STATUS_COLORS: Record<LeadStatus, string> = {
  nieuw: "bg-neutral-100 text-neutral-700",
  research: "bg-blue-100 text-blue-700",
  genereren: "bg-blue-100 text-blue-700",
  klaar: "bg-amber-100 text-amber-700",
  verzonden: "bg-purple-100 text-purple-700",
  geopend: "bg-purple-100 text-purple-700",
  klant: "bg-green-100 text-green-700",
  geblokkeerd: "bg-red-100 text-red-700",
  dood: "bg-neutral-200 text-neutral-500",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {LEAD_STATUS_LABELS[status]}
    </span>
  );
}
