import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PrintersSchema = z.object({
  small: z.string().max(255).default(""),
  large: z.string().max(255).default(""),
  other: z.string().max(255).default(""),
});

const ReworkMapSchema = z.record(
  z.string().min(1).max(128),
  z.object({
    id: z.number().int(),
    name: z.string().max(255),
    cost: z.number().finite().optional(),
  }),
);

const SettingsSchema = z.object({
  mintsoftBaseUrl: z.string().max(500).default(""),
  mintsoftUsername: z.string().max(255).default(""),
  mintsoftPassword: z.string().max(500).default(""),
  mintsoftApiKey: z.string().max(500).default(""),
  printers: PrintersSchema,
  silentPrint: z.boolean(),
  reworkClientId: z.string().max(64).default(""),
  reworkMap: ReworkMapSchema,
});

export const loadUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      mintsoftBaseUrl: data.mintsoft_base_url,
      mintsoftUsername: data.mintsoft_username,
      mintsoftPassword: data.mintsoft_password,
      mintsoftApiKey: data.mintsoft_api_key,
      printers: data.printers,
      silentPrint: data.silent_print,
      reworkClientId: data.rework_client_id,
      reworkMap: data.rework_map,
    };
  });

export const saveUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("user_settings").upsert({
      user_id: userId,
      mintsoft_base_url: data.mintsoftBaseUrl,
      mintsoft_username: data.mintsoftUsername,
      mintsoft_password: data.mintsoftPassword,
      mintsoft_api_key: data.mintsoftApiKey,
      printers: data.printers,
      silent_print: data.silentPrint,
      rework_client_id: data.reworkClientId,
      rework_map: data.reworkMap,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const checkUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error, count } = await supabase
      .from("user_settings")
      .select("user_id", { head: true, count: "exact" })
      .eq("user_id", userId);
    if (error) {
      return { ok: false as const, message: error.message };
    }
    return {
      ok: true as const,
      message: `Table reachable. ${count ?? 0} row(s) for you.`,
    };
  });
