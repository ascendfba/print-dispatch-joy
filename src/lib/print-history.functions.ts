import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const logSchema = z.object({
  printer: z.string().min(1).max(255),
  kind: z.string().max(50).optional().nullable(),
  label: z.string().max(255).optional().nullable(),
  orderId: z.string().max(100).optional().nullable(),
  byteSize: z.number().int().nonnegative().optional().nullable(),
  status: z.enum(["success", "error"]),
  error: z.string().max(1000).optional().nullable(),
  source: z.enum(["web", "desktop"]).default("web"),
});

export const logPrintEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => logSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("print_history").insert({
      user_id: userId,
      printer: data.printer,
      kind: data.kind ?? null,
      label: data.label ?? null,
      order_id: data.orderId ?? null,
      byte_size: data.byteSize ?? null,
      status: data.status,
      error: data.error ?? null,
      source: data.source,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPrintHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).default(100) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("print_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const clearPrintHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("print_history").delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });