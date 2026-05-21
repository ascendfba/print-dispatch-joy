import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runMintsoftSync } from "./mintsoft-sync.server";

export type CachedProduct = {
  id: number;
  sku: string | null;
  name: string | null;
  image_url: string | null;
  ean: string | null;
  upc: string | null;
  client_id: number | null;
  stock_level: number;
  allocated: number;
  on_hand: number;
};

export type CachedClient = {
  id: number;
  name: string | null;
  short_name: string | null;
  brand_name: string | null;
};

export type SyncState = {
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
  product_count: number | null;
  duration_ms: number | null;
};

export const getCachedProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const all: CachedProduct[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("mintsoft_products")
        .select("id, sku, name, image_url, ean, upc, client_id, stock_level, allocated, on_hand")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as CachedProduct[];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  });

export const getCachedClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("mintsoft_clients")
      .select("id, name, short_name, brand_name")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as CachedClient[];
  });

export const getSyncState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("mintsoft_sync_state")
      .select("last_run_at, last_success_at, last_status, last_error, product_count, duration_ms")
      .eq("id", "products")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as SyncState | null;
  });

export const triggerSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const result = await runMintsoftSync();
    return { ok: true, ...result };
  });