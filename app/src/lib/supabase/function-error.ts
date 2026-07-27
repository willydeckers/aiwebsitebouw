import { FunctionsHttpError } from "@supabase/supabase-js";

/**
 * supabase-js's functions.invoke() collapses every non-2xx response into the
 * generic FunctionsHttpError("Edge Function returned a non-2xx status code")
 * — the actual `{ error: "..." }` body our Edge Functions return is still on
 * `error.context` (the raw, unconsumed Response) and has to be read out
 * explicitly.
 */
export async function describeFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error as string;
    } catch {
      // Response wasn't JSON — fall back to the generic message below.
    }
  }
  return error instanceof Error ? error.message : String(error);
}
