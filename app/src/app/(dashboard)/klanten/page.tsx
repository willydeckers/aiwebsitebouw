import { createClient } from "@/lib/supabase/server";
import { KlantenList, type KlantRow } from "./klanten-list";

export default async function KlantenPage() {
  const supabase = await createClient();

  const { data: klanten, error } = await supabase
    .from("klanten")
    .select(
      "id, type, site_status, shopify_staff_account_status, shopify_domain, lead:leads(bedrijfsnaam)",
    )
    .order("id", { ascending: false });

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">Klanten</h1>

      {error ? (
        <p className="mt-4 text-sm text-red-600">Kon klanten niet laden: {error.message}</p>
      ) : !klanten || klanten.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">
          Nog geen klanten — markeer een lead als klant via het detailpaneel (spec sectie 3.8).
        </p>
      ) : (
        <KlantenList klanten={klanten as unknown as KlantRow[]} />
      )}
    </div>
  );
}
