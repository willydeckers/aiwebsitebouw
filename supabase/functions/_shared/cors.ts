// Desktop app talking directly to Supabase Edge Functions — no browser
// origin restriction needed the way a public website would; RLS + JWT
// verification is what actually gates access (see auth.ts).
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
