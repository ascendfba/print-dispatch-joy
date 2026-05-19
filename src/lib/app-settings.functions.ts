import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getDesktopAppUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "desktop_app_url")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const v = data?.value as { url?: string } | null;
    return { url: v?.url ?? "" };
  });

export const setDesktopAppUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ url: z.string().max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("app_settings").upsert({
      key: "desktop_app_url",
      value: { url: data.url },
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
