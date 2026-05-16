import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "https://kcezuzzefouwqbgbxuog.supabase.co";
const serviceKey = process.env.SB_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.warn("[supabase] SB_SERVICE_ROLE_KEY is not set — admin client will fail at runtime.");
}

export const supabaseAdmin = createClient(url, serviceKey ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});
