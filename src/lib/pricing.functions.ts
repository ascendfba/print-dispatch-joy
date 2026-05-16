import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RowSchema = z.object({
  client_id: z.string().min(1).max(64),
  client_name: z.string().max(255).nullable().optional(),
  rate_code: z.string().min(1).max(64),
  rate_per_unit: z.number().finite(),
});

export const listPricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("client_pricing")
      .select("client_id, client_name, rate_code, rate_per_unit");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const savePricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rows: z.array(RowSchema).max(5000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Replace-all strategy: delete user's rows, then insert new set.
    const { error: delErr } = await supabase
      .from("client_pricing")
      .delete()
      .eq("user_id", userId);
    if (delErr) throw new Error(delErr.message);
    if (data.rows.length === 0) return { count: 0 };
    const payload = data.rows.map((r) => ({ ...r, user_id: userId }));
    const { error: insErr } = await supabase.from("client_pricing").insert(payload);
    if (insErr) throw new Error(insErr.message);
    return { count: payload.length };
  });
