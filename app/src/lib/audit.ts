import { createClient } from "@/lib/supabase/client";
import { huidigEmail } from "@/lib/huidige-gebruiker";

// Spec section 6: audit_log has no viewer-facing requirement in section 7
// (it's not part of the security checklist), so this covers the key
// lifecycle events from the pipeline diagram (section 3) rather than
// every possible action — lead created/deleted/sent/converted, and
// sourcing-run completion.
export async function logAudit(actie: string, leadId?: string, detail?: Record<string, unknown>) {
  const supabase = createClient();
  const email = await huidigEmail(supabase);

  await supabase.from("audit_log").insert({
    gebruiker: email ?? "onbekend",
    actie,
    lead_id: leadId ?? null,
    detail: detail ?? null,
  });
}
