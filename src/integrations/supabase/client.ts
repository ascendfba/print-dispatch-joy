import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://kcezuzzefouwqbgbxuog.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_wxZZwf0qL3lKFs0iNd_kjA_-5fiAwzl";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});