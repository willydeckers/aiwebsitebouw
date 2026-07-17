import { createClient } from "@/lib/supabase/server";

type KlantRow = {
  id: string;
  type: "statisch" | "shopify";
  site_status: string | null;
  lead: { bedrijfsnaam: string } | null;
};

export default async function KlantenPage() {
  const supabase = await createClient();

  const { data: klanten, error } = await supabase
    .from("klanten")
    .select("id, type, site_status, lead:leads(bedrijfsnaam)")
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
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500">
              <th className="py-2 font-medium">Klantnaam</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 font-medium">Site-status</th>
            </tr>
          </thead>
          <tbody>
            {(klanten as unknown as KlantRow[]).map((klant) => (
              <tr key={klant.id} className="border-b border-neutral-100">
                <td className="py-2 font-medium text-neutral-900">
                  {klant.lead?.bedrijfsnaam ?? "Onbekend"}
                </td>
                <td className="py-2 text-neutral-600">{klant.type}</td>
                <td className="py-2 text-neutral-600">{klant.site_status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
