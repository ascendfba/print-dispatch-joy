import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MINTSOFT_BASE_URL = (process.env.MINTSOFT_BASE_URL || "https://api.mintsoft.co.uk").replace(/\/+$/, "");

function headers(): Record<string, string> {
  const key = process.env.MINTSOFT_API_KEY;
  if (!key) throw new Error("MINTSOFT_API_KEY env var is not set");
  return { Accept: "application/json", "ms-apikey": key };
}

async function msFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${MINTSOFT_BASE_URL}${path}`, { headers: headers() });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Mintsoft ${path} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  const txt = await res.text();
  if (!txt) return {} as T;
  return JSON.parse(txt) as T;
}

function num(r: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = r[k];
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

type Totals = { stockLevel: number; allocated: number; onHand: number };

async function listAllProductsServer() {
  const pageSize = 100; // Mintsoft caps Limit at 100
  const all: Array<Record<string, unknown>> = [];
  const seenIds = new Set<number>();
  let lastFirstId: unknown;
  let lastBatchLen = -1;
  for (let page = 1; page < 2000; page++) {
    const data = await msFetch<Record<string, unknown>[] | { Results?: Record<string, unknown>[] }>(
      `/api/Product/List?PageNo=${page}&Limit=${pageSize}`,
    );
    const batch = Array.isArray(data) ? data : ((data as { Results?: Record<string, unknown>[] })?.Results ?? []);
    console.log(`[mintsoft-sync] page=${page} batchLen=${batch.length} firstId=${batch[0]?.ID} lastId=${batch[batch.length - 1]?.ID} totalSoFar=${all.length}`);
    if (batch.length === 0) break;
    if (page > 1 && batch[0]?.ID === lastFirstId) {
      console.log(`[mintsoft-sync] echo detected at page ${page}, stopping`);
      break;
    }
    lastFirstId = batch[0]?.ID;
    let added = 0;
    for (const p of batch) {
      const id = Number(p.ID);
      if (!Number.isFinite(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      all.push(p);
      added++;
    }
    if (added === 0) {
      console.log(`[mintsoft-sync] no new IDs at page ${page}, stopping`);
      break;
    }
    if (batch.length < pageSize) {
      console.log(`[mintsoft-sync] short page ${batch.length}<${pageSize}, stopping`);
      break;
    }
    lastBatchLen = batch.length;
  }
  void lastBatchLen;
  console.log(`[mintsoft-sync] DONE — total unique products=${all.length}`);
  return all;
}

async function listWarehousesServer() {
  for (const path of ["/api/Warehouse", "/api/Warehouse/List", "/api/Warehouses"]) {
    try {
      const data = await msFetch<unknown>(path);
      const arr = Array.isArray(data) ? data : (data as { Results?: unknown[] })?.Results;
      if (!Array.isArray(arr)) continue;
      const out: number[] = [];
      for (const r of arr as Record<string, unknown>[]) {
        const id = Number(r.ID ?? r.Id ?? r.WarehouseId ?? r.WarehouseID);
        if (Number.isFinite(id)) out.push(id);
      }
      if (out.length) return out;
    } catch {
      /* try next */
    }
  }
  return [];
}

async function fetchTotalsForWarehouse(warehouseId: number): Promise<Map<number, Totals>> {
  for (const path of [
    `/api/Product/StockLevels?WarehouseID=${warehouseId}&Breakdown=true`,
    `/api/Product/StockLevels?WarehouseId=${warehouseId}&Breakdown=true`,
  ]) {
    try {
      const data = await msFetch<unknown>(path);
      const arr = Array.isArray(data) ? data : (data as { Results?: unknown[] })?.Results;
      if (!Array.isArray(arr)) continue;
      const out = new Map<number, Totals>();
      for (const r of arr as Record<string, unknown>[]) {
        const pid = Number(r.ProductId ?? r.ProductID ?? r.ID ?? r.Id);
        if (!Number.isFinite(pid)) continue;
        const breakdown = Array.isArray(r.Breakdown) ? (r.Breakdown as Record<string, unknown>[]) : [];
        const allocatedFromBreakdown = breakdown.reduce((s, item) => {
          const t = String(item?.Type ?? "").toLowerCase();
          return t.includes("allocation") ? s + num(item, ["Quantity", "Qty"]) : s;
        }, 0);
        out.set(pid, {
          stockLevel: num(r, ["StockLevel", "Stock Level", "TotalStockLevel", "Level"]),
          allocated: num(r, ["Allocated", "StockAllocated", "QuantityAllocated"]) || allocatedFromBreakdown,
          onHand: num(r, ["OnHand", "On Hand", "StockOnHand", "QuantityOnHand", "Level"]),
        });
      }
      return out;
    } catch {
      /* try next */
    }
  }
  return new Map();
}

async function listClientsServer() {
  try {
    const data = await msFetch<Record<string, unknown>[]>(`/api/Client`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function runMintsoftSync(): Promise<{ productCount: number; durationMs: number }> {
  const startedAt = Date.now();
  await supabaseAdmin.from("mintsoft_sync_state").upsert({
    id: "products",
    last_run_at: new Date().toISOString(),
    last_status: "running",
    last_error: null,
  });

  try {
    const [products, warehouses, clients] = await Promise.all([
      listAllProductsServer(),
      listWarehousesServer(),
      listClientsServer(),
    ]);

    // Aggregate stock totals across all warehouses
    const totals = new Map<number, Totals>();
    for (const wid of warehouses) {
      const w = await fetchTotalsForWarehouse(wid);
      for (const [pid, t] of w) {
        const e = totals.get(pid) ?? { stockLevel: 0, allocated: 0, onHand: 0 };
        totals.set(pid, {
          stockLevel: e.stockLevel + t.stockLevel,
          allocated: e.allocated + t.allocated,
          onHand: e.onHand + t.onHand,
        });
      }
    }

    // Upsert products in batches
    const rows = products
      .map((p) => {
        const id = Number(p.ID);
        if (!Number.isFinite(id)) return null;
        const t = totals.get(id) ?? { stockLevel: 0, allocated: 0, onHand: 0 };
        const clientId = Number(p.ClientId ?? p.ClientID);
        return {
          id,
          sku: (p.SKU as string) ?? null,
          name: (p.Name as string) ?? null,
          description: (p.Description as string) ?? null,
          image_url: (p.ImageURL as string) ?? (p.ImageUrl as string) ?? null,
          ean: (p.EAN as string) ?? null,
          upc: (p.UPC as string) ?? null,
          client_id: Number.isFinite(clientId) ? clientId : null,
          stock_level: t.stockLevel,
          allocated: t.allocated,
          on_hand: t.onHand,
          raw: p,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const { error } = await supabaseAdmin.from("mintsoft_products").upsert(slice, { onConflict: "id" });
      if (error) throw new Error(`Upsert products failed: ${error.message}`);
    }

    // Upsert clients
    const clientRows = clients
      .map((c) => {
        const id = Number(c.ID);
        if (!Number.isFinite(id)) return null;
        return {
          id,
          name: (c.Name as string) ?? null,
          short_name: (c.ShortName as string) ?? null,
          brand_name: (c.BrandName as string) ?? null,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (clientRows.length) {
      const { error } = await supabaseAdmin.from("mintsoft_clients").upsert(clientRows, { onConflict: "id" });
      if (error) throw new Error(`Upsert clients failed: ${error.message}`);
    }

    const durationMs = Date.now() - startedAt;
    await supabaseAdmin.from("mintsoft_sync_state").upsert({
      id: "products",
      last_run_at: new Date(startedAt).toISOString(),
      last_success_at: new Date().toISOString(),
      last_status: "success",
      last_error: null,
      product_count: rows.length,
      duration_ms: durationMs,
    });

    return { productCount: rows.length, durationMs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from("mintsoft_sync_state").upsert({
      id: "products",
      last_run_at: new Date(startedAt).toISOString(),
      last_status: "error",
      last_error: msg,
      duration_ms: Date.now() - startedAt,
    });
    throw e;
  }
}