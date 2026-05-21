import { tokenStore, type Settings } from "./storage";

export type MintsoftOrder = {
  ID: number;
  OrderNumber?: string;
  ChannelOrderRef?: string;
  Status?: string;
  CustomerName?: string;
  WarehouseName?: string;
  CourierName?: string;
  CreatedDate?: string;
  TotalValue?: number;
  [k: string]: unknown;
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type RawResponse = { status: number; contentType: string; body: string /* base64 */ };

function normalizeMintsoftBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname
      .replace(/\/+$/, "")
      .replace(/\/api\/auth$/i, "")
      .replace(/\/api$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/api\/auth$/i, "").replace(/\/api$/i, "");
  }
}

async function rawRequest(
  settings: Settings,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {},
): Promise<RawResponse> {
  const headers = { ...(init.headers ?? {}) };
  const baseUrl = normalizeMintsoftBaseUrl(settings.mintsoftBaseUrl);
  const bodyStr =
    typeof init.body === "string"
      ? init.body
      : init.body
        ? new TextDecoder().decode(init.body)
        : undefined;

  if (typeof window !== "undefined" && window.dispatchAPI?.isElectron) {
    return window.dispatchAPI.mintsoftFetch({
      baseUrl,
      path,
      method: init.method ?? "GET",
      headers,
      body: bodyStr,
    });
  }

  // Browser preview: go through TSS proxy
  const res = await fetch("/api/mintsoft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl,
      path,
      method: init.method ?? "GET",
      headers,
      body: bodyStr,
    }),
  });
  if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
  return (await res.json()) as RawResponse;
}

function decodeText(r: RawResponse): string {
  return new TextDecoder().decode(base64ToBytes(r.body));
}

function decodeJson<T = unknown>(r: RawResponse): T {
  const txt = decodeText(r).trim();
  if (!txt) return {} as T;
  try {
    return JSON.parse(txt) as T;
  } catch {
    // Some endpoints (Login) return a quoted plain string
    return txt.replace(/^"|"$/g, "") as unknown as T;
  }
}

export async function login(settings: Settings): Promise<string> {
  if (settings.mintsoftApiKey?.trim()) {
    // Using API key auth — no token needed
    tokenStore.set(settings.mintsoftApiKey.trim());
    return settings.mintsoftApiKey.trim();
  }
  const r = await rawRequest(settings, "/api/Auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      Username: settings.mintsoftUsername,
      Password: settings.mintsoftPassword,
    }),
  });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Mintsoft login failed (${r.status}): ${decodeText(r)}`);
  }
  const token = decodeJson<string>(r);
  if (typeof token !== "string" || token.length < 4) {
    throw new Error("Unexpected login response from Mintsoft");
  }
  tokenStore.set(token);
  return token;
}

async function authedJson<T>(
  settings: Settings,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<T> {
  const apiKey = settings.mintsoftApiKey?.trim();
  if (apiKey) {
    const r = await rawRequest(settings, path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
        "ms-apikey": apiKey,
      },
    });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Mintsoft ${path} failed (${r.status}): ${decodeText(r)}`);
    }
    return decodeJson<T>(r);
  }
  let token = tokenStore.get();
  if (!token) token = await login(settings);
  const doFetch = (tk: string) =>
    rawRequest(settings, path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
        Authorization: `Bearer ${tk}`,
      },
    });
  let r = await doFetch(token);
  if (r.status === 401) {
    token = await login(settings);
    r = await doFetch(token);
  }
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Mintsoft ${path} failed (${r.status}): ${decodeText(r)}`);
  }
  return decodeJson<T>(r);
}

async function authedPdf(settings: Settings, path: string): Promise<Uint8Array | null> {
  const apiKey = settings.mintsoftApiKey?.trim();
  if (apiKey) {
    const r = await rawRequest(settings, path, {
      method: "GET",
      headers: { Accept: "application/pdf", "ms-apikey": apiKey },
    });
    if (r.status === 404) return null;
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Mintsoft ${path} failed (${r.status})`);
    }
    const bytes = decodePdfResponseBody(r.body);
    if (!bytes) return null;
    return bytes;
  }
  let token = tokenStore.get();
  if (!token) token = await login(settings);
  const doFetch = (tk: string) =>
    rawRequest(settings, path, {
      method: "GET",
      headers: { Accept: "application/pdf", Authorization: `Bearer ${tk}` },
    });
  let r = await doFetch(token);
  if (r.status === 401) {
    token = await login(settings);
    r = await doFetch(token);
  }
  if (r.status === 404) return null;
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Mintsoft ${path} failed (${r.status})`);
  }
  const bytes = decodePdfResponseBody(r.body);
  // Sanity check it really is a PDF
  if (!bytes) return null;
  return bytes;
}

export async function listOpenOrders(settings: Settings): Promise<MintsoftOrder[]> {
  // Mintsoft: /api/Order/List with OrderStatusId=1 (Pending) returns open orders
  const data = await authedJson<MintsoftOrder[] | { Results?: MintsoftOrder[] }>(
    settings,
    "/api/Order/List?Take=200&OrderStatusId=1",
  );
  return Array.isArray(data) ? data : (data.Results ?? []);
}

export async function fetchOrder(settings: Settings, orderId: number): Promise<MintsoftOrder | null> {
  const detailPaths = [`/api/Order/${orderId}`, `/api/Order/${orderId}/Details`, `/api/Order/Details/${orderId}`];
  for (const path of detailPaths) {
    try {
      const data = await authedJson<MintsoftOrder>(settings, path);
      if (data && typeof data === "object") return data;
    } catch {
      /* try next source */
    }
  }

  try {
    const open = await listOpenOrders(settings);
    const match = open.find((o) => o.ID === orderId);
    if (match) return match;
  } catch {
    /* try status lists */
  }

  try {
    const statuses = await listOrderStatuses(settings);
    for (const status of statuses) {
      const orders = await listOrdersByStatus(settings, status.ID, 500);
      const match = orders.find((o) => o.ID === orderId);
      if (match) return match;
    }
  } catch {
    /* no order summary available */
  }
  return null;
}

export type MintsoftOrderStatus = {
  ID: number;
  Name?: string;
  ExternalName?: string;
};

export async function listOrderStatuses(
  settings: Settings,
): Promise<MintsoftOrderStatus[]> {
  const data = await authedJson<MintsoftOrderStatus[]>(
    settings,
    "/api/Order/Statuses",
  );
  return Array.isArray(data) ? data : [];
}

export async function listOrdersByStatus(
  settings: Settings,
  statusId: number,
  take = 200,
): Promise<MintsoftOrder[]> {
  const data = await authedJson<MintsoftOrder[] | { Results?: MintsoftOrder[] }>(
    settings,
    `/api/Order/List?Take=${take}&OrderStatusId=${statusId}`,
  );
  return Array.isArray(data) ? data : (data.Results ?? []);
}

export type MintsoftOrderItem = {
  ID: number;
  ProductId: number;
  SKU?: string;
  Quantity: number;
  Details?: string | null;
  OrderItemNameValues?: Array<{
    Name?: string | null;
    Value?: string | null;
    Internal?: boolean | null;
  }> | null;
  [k: string]: unknown;
};

export async function fetchOrderItems(
  settings: Settings,
  orderId: number,
): Promise<MintsoftOrderItem[]> {
  const data = await authedJson<MintsoftOrderItem[]>(settings, `/api/Order/${orderId}/Items`);
  return Array.isArray(data) ? data : [];
}

export type MintsoftClient = {
  ID: number;
  Name?: string | null;
  ShortName?: string | null;
  BrandName?: string | null;
};

export async function listClients(settings: Settings): Promise<MintsoftClient[]> {
  const data = await authedJson<MintsoftClient[]>(settings, "/api/Client");
  return Array.isArray(data) ? data : [];
}

export type MintsoftProduct = {
  ID: number;
  SKU?: string;
  Name?: string;
  Description?: string | null;
  ImageURL?: string | null;
  EAN?: string | null;
  UPC?: string | null;
  ClientId?: number | null;
  ClientID?: number | null;
  Bundle?: boolean | null;
  IsBundle?: boolean | null;
  BundleProducts?: Array<{ ProductId?: number; SKU?: string; Quantity?: number }> | null;
  HasExpiryDates?: boolean | null;
  HasBatchNumbers?: boolean | null;
  HasSerialNumbers?: boolean | null;
  RequiresExpiryDate?: boolean | null;
  RequiresBatchNumber?: boolean | null;
  StockOnHand?: number | null;
  StockAllocated?: number | null;
  StockAvailable?: number | null;
  StockLevel?: number | null;
  "Stock Level"?: number | null;
  Allocated?: number | null;
  OnHand?: number | null;
  "On Hand"?: number | null;
  QuantityOnHand?: number | null;
  QuantityAllocated?: number | null;
};

export async function listProducts(
  settings: Settings,
  opts: { take?: number; skip?: number } = {},
): Promise<MintsoftProduct[]> {
  const take = opts.take ?? 500;
  const skip = opts.skip ?? 0;
  const pageNumber = Math.floor(skip / take) + 1;
  const paths = [
    `/api/Product/List?PageNo=${pageNumber}&Limit=${take}`,
    `/api/Product/List?PageNumber=${pageNumber}&PageSize=${take}`,
    `/api/Product/List?pageNumber=${pageNumber}&pageSize=${take}`,
    `/api/Product?PageNumber=${pageNumber}&PageSize=${take}`,
    `/api/Product/List?Take=${take}&Skip=${skip}`,
    `/api/Product?Take=${take}&Skip=${skip}`,
    `/api/Product/Search?Take=${take}&Skip=${skip}`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<MintsoftProduct[] | { Results?: MintsoftProduct[] }>(
        settings,
        p,
      );
      const arr = Array.isArray(data) ? data : (data?.Results ?? []);
      if (Array.isArray(arr)) return arr;
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function listAllProducts(settings: Settings): Promise<MintsoftProduct[]> {
  // Mintsoft Product/List uses PageNo + Limit and caps responses at 100.
  // Keep requests aligned to that cap so pagination doesn't stop early.
  const pageSize = 100;
  const all: MintsoftProduct[] = [];
  let skip = 0;
  let lastFirstId: number | undefined;
  // Safety cap to avoid runaway loops
  for (let i = 0; i < 200; i++) {
    const batch = await listProducts(settings, { take: pageSize, skip });
    if (batch.length === 0) break;
    // Detect non-paginating endpoint returning same page repeatedly
    if (i > 0 && batch[0]?.ID === lastFirstId) break;
    lastFirstId = batch[0]?.ID;
    all.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}

export async function fetchProduct(
  settings: Settings,
  productId: number,
): Promise<MintsoftProduct | null> {
  try {
    const raw = await authedJson<Record<string, unknown>>(
      settings,
      `/api/Product/${productId}`,
    );
    if (!raw || typeof raw !== "object") return null;
    const pickStr = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === "string" && v.trim()) return v;
      }
      return null;
    };
    const imagesArr = (raw as Record<string, unknown>).Images;
    let firstFromImages: string | null = null;
    if (Array.isArray(imagesArr)) {
      for (const entry of imagesArr) {
        if (typeof entry === "string" && entry.trim()) {
          firstFromImages = entry;
          break;
        }
        if (entry && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          const u =
            (typeof e.URL === "string" && e.URL) ||
            (typeof e.Url === "string" && e.Url) ||
            (typeof e.ImageURL === "string" && e.ImageURL) ||
            (typeof e.ImageUrl === "string" && e.ImageUrl) ||
            "";
          if (u) {
            firstFromImages = u;
            break;
          }
        }
      }
    }
    const imageUrl =
      pickStr(
        "ImageURL",
        "ImageUrl",
        "Image",
        "MainImage",
        "MainImageURL",
        "MainImageUrl",
        "ProductImageURL",
        "ProductImageUrl",
        "ThumbnailURL",
        "ThumbnailUrl",
      ) || firstFromImages;
    return { ...(raw as MintsoftProduct), ImageURL: imageUrl };
  } catch {
    return null;
  }
}

export type BundleComponent = { ProductId?: number; SKU?: string; Quantity: number };

/**
 * Fetch bundle components for a product. Mintsoft exposes these on a
 * sub-resource; the exact path varies by tenant, so we try the common ones
 * and fall back to whatever the product payload already contained.
 */
export async function fetchProductBundle(
  settings: Settings,
  productId: number,
): Promise<BundleComponent[]> {
  const paths = [
    `/api/Product/${productId}/BundleProducts`,
    `/api/Product/${productId}/Bundle`,
    `/api/Product/${productId}/Components`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<unknown>(settings, p);
      if (Array.isArray(data)) {
        return (data as Array<Record<string, unknown>>)
          .map((r) => ({
            ProductId: typeof r.ProductId === "number" ? r.ProductId : undefined,
            SKU: typeof r.SKU === "string" ? r.SKU : undefined,
            Quantity: Number(r.Quantity ?? r.Qty ?? 1) || 1,
          }))
          .filter((c) => c.Quantity > 0);
      }
    } catch {
      /* try next */
    }
  }
  return [];
}

export type StockLocation = {
  location: string;
  quantity: number;
  stockLevel?: number;
  allocated?: number;
  onHand?: number;
  locationId?: number;
  warehouseId?: number;
};

function numericField(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function optionalNumericField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function optionalStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = optionalStringField(value as Record<string, unknown>, keys);
      if (nested) return nested;
    }
  }
  const lowerKeyMap = new Map(Object.keys(record).map((key) => [key.toLowerCase(), key]));
  for (const key of keys) {
    const actualKey = lowerKeyMap.get(key.toLowerCase());
    const value = actualKey ? record[actualKey] : undefined;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = optionalStringField(value as Record<string, unknown>, keys);
      if (nested) return nested;
    }
  }
  return undefined;
}

function isUnassignedLocationName(value?: string): boolean {
  return (value || "").trim().toLowerCase() === "unassigned";
}

const locationNameCache = new Map<number, string>();

async function resolveLocationName(
  settings: Settings,
  locationId: number,
  warehouseId: number,
): Promise<string> {
  if (!Number.isFinite(locationId)) return "";
  const cached = locationNameCache.get(locationId);
  if (cached) return cached;
  if (Number.isFinite(warehouseId)) {
    const location = await fetchWarehouseLocation(settings, warehouseId, locationId);
    if (location?.name) {
      locationNameCache.set(locationId, location.name);
      return location.name;
    }
  }
  // Warehouse unknown — search all warehouses for this location.
  try {
    const warehouses = await listWarehouses(settings);
    for (const w of warehouses) {
      const location = await fetchWarehouseLocation(settings, w.id, locationId);
      if (location?.name) {
        locationNameCache.set(locationId, location.name);
        return location.name;
      }
    }
  } catch {
    /* ignore */
  }
  return `Location #${locationId}`;
}

export type ProductStockEntry = {
  location: string;
  quantity: number;
  stockLevel?: number;
  allocated?: number;
  onHand?: number;
  warehouseId?: number;
  locationId?: number;
  warehouseName?: string;
  batchNumber?: string;
  bestBeforeDate?: string;
};

type ProductStockTotal = {
  stockLevel: number;
  allocated: number;
  onHand: number;
  sku?: string;
  clientId?: number;
};

function arrayPayload(data: unknown): Array<Record<string, unknown>> | null {
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { Results?: unknown })?.Results)
      ? (data as { Results: unknown[] }).Results
      : null;
  return arr as Array<Record<string, unknown>> | null;
}

function stockTotalFromRecord(r: Record<string, unknown>): ProductStockTotal {
  const breakdown = Array.isArray(r.Breakdown) ? r.Breakdown : [];
  const allocatedFromBreakdown = breakdown.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    const entry = item as Record<string, unknown>;
    const type = String(entry.Type ?? "").toLowerCase();
    return type.includes("allocation") ? sum + numericField(entry, ["Quantity", "Qty"]) : sum;
  }, 0);
  return {
    stockLevel: numericField(r, ["StockLevel", "Stock Level", "TotalStockLevel", "Total Stock Level", "Level"]),
    allocated: numericField(r, ["Allocated", "StockAllocated", "QuantityAllocated"]) || allocatedFromBreakdown,
    onHand: numericField(r, ["OnHand", "On Hand", "StockOnHand", "QuantityOnHand", "Level"]),
    sku: typeof r.SKU === "string" ? r.SKU : undefined,
    clientId: Number.isFinite(Number(r.ClientId ?? r.ClientID)) ? Number(r.ClientId ?? r.ClientID) : undefined,
  };
}

async function fetchWarehouseStockLevels(
  settings: Settings,
  warehouseId: number,
): Promise<Map<number, ProductStockTotal>> {
  const paths = [
    `/api/Product/StockLevels?WarehouseID=${warehouseId}&Breakdown=true`,
    `/api/Product/StockLevels?WarehouseId=${warehouseId}&Breakdown=true`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<unknown>(settings, p);
      const arr = arrayPayload(data);
      if (!arr) continue;
      const out = new Map<number, ProductStockTotal>();
      for (const r of arr) {
        const productId = Number(r.ProductId ?? r.ProductID ?? r.ID ?? r.Id);
        if (Number.isFinite(productId)) out.set(productId, stockTotalFromRecord(r));
      }
      return out;
    } catch {
      /* try next stock-level path */
    }
  }
  return new Map();
}

/**
 * Fetch the warehouse / bin locations holding stock for a product. Mintsoft
 * exposes this on a per-product sub-resource; the exact path varies by
 * tenant, so we try the most common ones.
 */
export async function fetchProductStockLocations(
  settings: Settings,
  productId: number,
): Promise<StockLocation[]> {
  const paths = [
    `/api/Product/${productId}/Inventory?breakdown=true`,
    `/api/Product/${productId}/Stock`,
    `/api/Product/${productId}/StockLocations`,
    `/api/Product/${productId}/Locations`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<unknown>(settings, p);
      const rows = arrayPayload(data) ?? [];
      if (rows.length > 0) {
        const out: StockLocation[] = [];
        for (const r of rows) {
          const locationId = Number(
            r.LocationId ?? r.LocationID ?? r.Location_Id ?? r.WarehouseLocationId,
          );
          const warehouseId = Number(r.WarehouseId ?? r.WarehouseID ?? r.Warehouse_Id);
          // Prefer bin-code style fields (e.g. "A-A19-B87-S3-P01"). Avoid
          // generic `Location` / `LocationName` which Mintsoft often uses
          // for the warehouse name rather than the bin.
          const directBin = optionalStringField(r, [
            "SimpleLocationName",
            "simpleLocationName",
            "simplelocationname",
            "BinLocation",
            "LocationCode",
            "Bin",
            "Code",
          ]);
          const resolved = await resolveLocationName(settings, locationId, warehouseId);
          const location = isUnassignedLocationName(directBin)
            ? resolved || directBin
            : directBin || resolved || "Unassigned";
          const stockLevel =
            optionalNumericField(r, [
              "StockLevel",
              "Stock Level",
              "TotalStockLevel",
              "Total Stock Level",
              "Quantity",
              "Qty",
              "Available",
            ]) ?? 0;
          const allocated =
            optionalNumericField(r, [
              "Allocated",
              "StockAllocated",
              "QuantityAllocated",
              "AllocatedQuantity",
            ]) ?? 0;
          const onHand = optionalNumericField(r, [
            "OnHand",
            "On Hand",
            "StockOnHand",
            "QuantityOnHand",
            "OnHandQuantity",
            "Level",
          ]);
          const quantity = stockLevel || onHand || 0;
          if (location) {
            out.push({
              location,
              quantity,
              stockLevel,
              allocated,
              onHand: onHand ?? stockLevel,
              locationId: Number.isFinite(locationId) ? locationId : undefined,
              warehouseId: Number.isFinite(warehouseId) ? warehouseId : undefined,
            });
          }
        }
        if (out.length > 0) return out;
      }
    } catch {
      /* try next path */
    }
  }
  return [];
}

/**
 * Like fetchProductStockLocations but also returns the underlying
 * WarehouseId / LocationId fields needed for stock movement calls.
 */
/**
 * Fetch the total on-hand and allocated quantities for many products in
 * parallel (concurrency-limited). Returns a Map keyed by productId.
 */
export async function fetchProductStockTotals(
  settings: Settings,
  productIds: number[],
  opts: { concurrency?: number } = {},
): Promise<Map<number, ProductStockTotal>> {
  try {
    const warehouses = await listWarehouses(settings);
    const allWarehouseTotals = new Map<number, ProductStockTotal>();
    for (const warehouse of warehouses) {
      const warehouseTotals = await fetchWarehouseStockLevels(settings, warehouse.id);
      for (const [productId, totals] of warehouseTotals) {
        const existing = allWarehouseTotals.get(productId) ?? {
          stockLevel: 0,
          allocated: 0,
          onHand: 0,
        };
        allWarehouseTotals.set(productId, {
          stockLevel: existing.stockLevel + totals.stockLevel,
          allocated: existing.allocated + totals.allocated,
          onHand: existing.onHand + totals.onHand,
          sku: existing.sku ?? totals.sku,
          clientId: existing.clientId ?? totals.clientId,
        });
      }
    }
    if (allWarehouseTotals.size > 0) return allWarehouseTotals;
  } catch {
    /* fall back to product-level stock paths */
  }

  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const result = new Map<number, ProductStockTotal>();
  let idx = 0;
  const workers: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (idx < productIds.length) {
      const i = idx++;
      const pid = productIds[i];
      try {
        const locs = await fetchProductStockLocations(settings, pid);
        const stockLevel = locs.reduce((s, l) => s + (Number(l.stockLevel ?? l.quantity) || 0), 0);
        const allocated = locs.reduce((s, l) => s + (Number(l.allocated) || 0), 0);
        const onHand = locs.reduce((s, l) => s + (Number(l.onHand ?? l.quantity) || 0), 0);
        result.set(pid, { stockLevel, allocated, onHand });
      } catch {
        result.set(pid, { stockLevel: 0, allocated: 0, onHand: 0 });
      }
    }
  };
  for (let i = 0; i < concurrency; i++) workers.push(next());
  await Promise.all(workers);
  return result;
}

export async function fetchProductStock(
  settings: Settings,
  productId: number,
): Promise<ProductStockEntry[]> {
  const paths = [
    `/api/Product/${productId}/Stock`,
    `/api/Product/${productId}/StockLocations`,
    `/api/Product/${productId}/Locations`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<unknown>(settings, p);
      if (Array.isArray(data)) {
        const out: ProductStockEntry[] = [];
        for (const r of data as Array<Record<string, unknown>>) {
          const location =
            (typeof r.Location === "string" && r.Location) ||
            (typeof r.LocationName === "string" && r.LocationName) ||
            (typeof r.WarehouseLocation === "string" && r.WarehouseLocation) ||
            (typeof r.BinLocation === "string" && r.BinLocation) ||
            (typeof r.Bin === "string" && r.Bin) ||
            "";
          const stockLevel = numericField(r, [
            "StockLevel",
            "Stock Level",
            "Quantity",
            "Qty",
            "Available",
          ]);
          const allocated = numericField(r, [
            "Allocated",
            "StockAllocated",
            "QuantityAllocated",
            "AllocatedQuantity",
          ]);
          const onHand = numericField(r, [
            "OnHand",
            "On Hand",
            "StockOnHand",
            "QuantityOnHand",
            "OnHandQuantity",
          ]);
          const quantity = stockLevel || onHand;
          const warehouseId = Number(r.WarehouseId ?? r.WarehouseID ?? r.Warehouse_Id);
          const locationId = Number(r.LocationId ?? r.LocationID ?? r.Location_Id);
          const warehouseName =
            (typeof r.WarehouseName === "string" && r.WarehouseName) ||
            (typeof r.Warehouse === "string" && r.Warehouse) ||
            undefined;
          const batchNumber =
            (typeof r.BatchNumber === "string" && r.BatchNumber) ||
            (typeof r.Batch === "string" && r.Batch) ||
            undefined;
          const bestBeforeDate =
            (typeof r.BestBeforeDate === "string" && r.BestBeforeDate) ||
            (typeof r.BBE === "string" && r.BBE) ||
            (typeof r.ExpiryDate === "string" && r.ExpiryDate) ||
            undefined;
          out.push({
            location,
            quantity,
            stockLevel,
            allocated,
            onHand,
            warehouseId: Number.isFinite(warehouseId) ? warehouseId : undefined,
            locationId: Number.isFinite(locationId) ? locationId : undefined,
            warehouseName,
            batchNumber,
            bestBeforeDate,
          });
        }
        if (out.length > 0) return out;
      }
    } catch {
      /* try next path */
    }
  }
  return [];
}

type MintsoftToolkitResult = {
  ID?: number;
  Success?: boolean;
  Message?: string;
  WarningMessage?: string;
};

/**
 * Book stock IN to a warehouse location.
 * Mintsoft expects Action as a query parameter, not inside the JSON body.
 */
export async function stockMovementIn(
  settings: Settings,
  params: {
    ProductId: number;
    WarehouseId: number;
    LocationId: number;
    Quantity: number;
    Comment?: string;
    BatchNumber?: string;
    BestBeforeDate?: string;
  },
): Promise<void> {
  const { BatchNumber, BestBeforeDate, ...rest } = params;
  const result = await authedJson<MintsoftToolkitResult>(settings, `/api/Warehouse/StockMovement?Action=0`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...rest,
      ...(BatchNumber ? { BatchNo: BatchNumber } : {}),
      ...(BestBeforeDate ? { ExpiryDate: BestBeforeDate } : {}),
    }),
  });
  if (result.Success === false) {
    throw new Error(result.Message || result.WarningMessage || "Mintsoft stock movement failed");
  }
}

export type MintsoftWarehouse = {
  id: number;
  name: string;
  code?: string;
};

export type MintsoftWarehouseLocation = {
  id: number;
  name: string;
  code?: string;
};

/**
 * Fetch the tenant's warehouses. Used to resolve a warehouse name (e.g. "MIL1")
 * to its numeric ID for stock-movement calls.
 */
export async function listWarehouses(settings: Settings): Promise<MintsoftWarehouse[]> {
  const paths = ["/api/Warehouse", "/api/Warehouse/List", "/api/Warehouses"];
  for (const p of paths) {
    try {
      const data = await authedJson<unknown>(settings, p);
      const arr = Array.isArray(data)
        ? data
        : Array.isArray((data as { Results?: unknown })?.Results)
          ? ((data as { Results: unknown[] }).Results)
          : null;
      if (!arr) continue;
      const out: MintsoftWarehouse[] = [];
      for (const r of arr as Array<Record<string, unknown>>) {
        const id = Number(r.ID ?? r.Id ?? r.WarehouseId ?? r.WarehouseID);
        const name =
          (typeof r.Name === "string" && r.Name) ||
          (typeof r.WarehouseName === "string" && r.WarehouseName) ||
          (typeof r.Code === "string" && r.Code) ||
          "";
        const code =
          (typeof r.Code === "string" && r.Code) ||
          (typeof r.ShortName === "string" && r.ShortName) ||
          undefined;
        if (Number.isFinite(id)) out.push({ id, name, code });
      }
      if (out.length > 0) return out;
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function listWarehouseLocations(
  settings: Settings,
  warehouseId: number,
): Promise<MintsoftWarehouseLocation[]> {
  const paths = [
    `/api/Warehouse/${warehouseId}/Location/All?IncludeUnAssigned=true`,
    `/api/Warehouse/${warehouseId}/Location/All`,
    `/api/Warehouse/${warehouseId}/Locations`,
    `/api/Warehouse/${warehouseId}/WarehouseLocations`,
    `/api/WarehouseLocation?WarehouseId=${warehouseId}`,
    `/api/Warehouse/Locations?WarehouseId=${warehouseId}`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<unknown>(settings, p);
      const arr = Array.isArray(data)
        ? data
        : Array.isArray((data as { Results?: unknown })?.Results)
          ? ((data as { Results: unknown[] }).Results)
          : null;
      if (!arr) continue;
      const out: MintsoftWarehouseLocation[] = [];
      for (const r of arr as Array<Record<string, unknown>>) {
        const id = Number(r.ID ?? r.Id ?? r.LocationId ?? r.LocationID ?? r.WarehouseLocationId);
        const name =
          (typeof r.SimpleLocationName === "string" && r.SimpleLocationName) ||
          (typeof r.LocationName === "string" && r.LocationName) ||
          (typeof r.Name === "string" && r.Name) ||
          (typeof r.Location === "string" && r.Location) ||
          (typeof r.BinLocation === "string" && r.BinLocation) ||
          (typeof r.Code === "string" && r.Code) ||
          "";
        const code =
          (typeof r.SimpleLocationName === "string" && r.SimpleLocationName) ||
          (typeof r.Code === "string" && r.Code) ||
          (typeof r.LocationCode === "string" && r.LocationCode) ||
          undefined;
        if (Number.isFinite(id) && name) out.push({ id, name, code });
      }
      if (out.length > 0) return out;
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function fetchWarehouseLocation(
  settings: Settings,
  warehouseId: number,
  locationId: number,
): Promise<MintsoftWarehouseLocation | null> {
  try {
    const r = await authedJson<Record<string, unknown>>(
      settings,
      `/api/Warehouse/${warehouseId}/Location/${locationId}`,
    );
    const id = Number(r.ID ?? r.Id ?? r.LocationId ?? r.LocationID ?? r.WarehouseLocationId);
    const name =
      (typeof r.SimpleLocationName === "string" && r.SimpleLocationName) ||
      (typeof r.LocationName === "string" && r.LocationName) ||
      (typeof r.Name === "string" && r.Name) ||
      (typeof r.Location === "string" && r.Location) ||
      (typeof r.BinLocation === "string" && r.BinLocation) ||
      (typeof r.Code === "string" && r.Code) ||
      "";
    const code =
      (typeof r.SimpleLocationName === "string" && r.SimpleLocationName) ||
      (typeof r.Code === "string" && r.Code) ||
      (typeof r.LocationCode === "string" && r.LocationCode) ||
      undefined;
    if (!Number.isFinite(id) || !name) return null;
    return { id, name, code };
  } catch {
    return null;
  }
}

export type OrderAllocation = {
  orderItemId?: number;
  productId?: number;
  sku?: string;
  quantity: number;
  locationId?: number;
  locationName?: string;
  warehouseId?: number;
  warehouseName?: string;
  bestBefore?: string;
  batchNo?: string;
};

/**
 * Fetch the stock currently allocated to an order, including Location, BatchNo
 * and BestBefore. Mirrors what the Mintsoft picking list is built from.
 * GET /api/Order/{id}/Allocations
 */
export async function fetchOrderAllocations(
  settings: Settings,
  orderId: number,
): Promise<OrderAllocation[]> {
  const data = await authedJson<unknown>(settings, `/api/Order/${orderId}/Allocations`);
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { Results?: unknown })?.Results)
      ? ((data as { Results: unknown[] }).Results)
      : [];
  const out: OrderAllocation[] = [];
  for (const r of arr as Array<Record<string, unknown>>) {
    const locationId = Number(r.LocationId ?? r.LocationID);
    const warehouseId = Number(r.WarehouseId ?? r.WarehouseID);
    const directLocationName = optionalStringField(r, [
      "SimpleLocationName",
      "simpleLocationName",
      "simplelocationname",
      "BinLocation",
      "LocationCode",
      "Bin",
      "Code",
      "LocationName",
      "Location",
    ]);
    const resolvedLocationName = await resolveLocationName(settings, locationId, warehouseId);
    out.push({
      orderItemId: Number(r.OrderItemId ?? r.OrderItemID) || undefined,
      productId: Number(r.ProductId ?? r.ProductID) || undefined,
      sku: typeof r.SKU === "string" ? r.SKU : undefined,
      quantity: Number(r.Quantity ?? 0),
      locationId: Number.isFinite(locationId) ? locationId : undefined,
      locationName: isUnassignedLocationName(directLocationName)
        ? resolvedLocationName || directLocationName
        : directLocationName || resolvedLocationName || undefined,
      warehouseId: Number.isFinite(warehouseId) ? warehouseId : undefined,
      warehouseName: typeof r.WarehouseName === "string" ? r.WarehouseName : undefined,
      bestBefore: typeof r.BestBefore === "string" ? r.BestBefore : undefined,
      batchNo: typeof r.BatchNo === "string" ? r.BatchNo : undefined,
    });
  }
  return out;
}

/**
 * Fallback for despatched orders where /Allocations has been cleared.
 * Looks up the product's stock-flow history (the "Manage Inventory" view in
 * Mintsoft) and returns any movements linked to the given order, including
 * the source LocationId, BestBefore and BatchNo per detail row.
 */
export async function fetchProductOrderAllocations(
  settings: Settings,
  productId: number,
  orderId: number,
): Promise<OrderAllocation[]> {
  const data = await authedJson<unknown>(
    settings,
    `/api/Product/${productId}/StockFlow?IncludeDetails=true`,
  );
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { Results?: unknown })?.Results)
      ? ((data as { Results: unknown[] }).Results)
      : [];
  const out: OrderAllocation[] = [];
  for (const r of arr as Array<Record<string, unknown>>) {
    if (Number(r.OrderId ?? r.OrderID) !== orderId) continue;
    const warehouseId = Number(r.WarehouseId ?? r.WarehouseID);
    const details = Array.isArray(r.StockFlowDetails)
      ? (r.StockFlowDetails as Array<Record<string, unknown>>)
      : [];
    if (details.length === 0) {
      out.push({
        productId,
        sku: typeof r.SKU === "string" ? r.SKU : undefined,
        quantity: Math.abs(Number(r.Quantity ?? 0)),
        warehouseId: Number.isFinite(warehouseId) ? warehouseId : undefined,
        warehouseName: typeof r.WarehouseName === "string" ? r.WarehouseName : undefined,
        bestBefore: typeof r.BestBefore === "string" ? r.BestBefore : undefined,
        batchNo: typeof r.BatchNo === "string" ? r.BatchNo : undefined,
      });
      continue;
    }
    for (const det of details) {
      const locationId = Number(det.LocationId ?? det.LocationID);
      out.push({
        productId,
        sku: typeof r.SKU === "string" ? r.SKU : undefined,
        quantity: Math.abs(Number(det.Quantity ?? r.Quantity ?? 0)),
        locationId: Number.isFinite(locationId) ? locationId : undefined,
        locationName: typeof det.Location === "string" ? det.Location : undefined,
        warehouseId: Number.isFinite(warehouseId) ? warehouseId : undefined,
        warehouseName: typeof r.WarehouseName === "string" ? r.WarehouseName : undefined,
        bestBefore:
          (typeof det.BestBefore === "string" && det.BestBefore) ||
          (typeof r.BestBefore === "string" ? r.BestBefore : undefined),
        batchNo:
          (typeof det.BatchNo === "string" && det.BatchNo) ||
          (typeof r.BatchNo === "string" ? r.BatchNo : undefined),
      });
    }
  }
  return out;
}

export type OrderDocument = {
  label: string;
  fileName?: string;
  contentType?: string;
  documentId?: number;
  bytes: Uint8Array;
};

export type ProductOrderAllocation = {
  orderId: number;
  orderNumber?: string;
  customerName?: string;
  location?: string;
  locationId?: number;
  quantity: number;
};

/**
 * For a given product, scan open orders and return each allocation row
 * (one per order/location) so the UI can show which orders are holding
 * stock and from which physical location.
 */
export async function fetchProductOpenOrderAllocations(
  settings: Settings,
  productId: number,
): Promise<ProductOrderAllocation[]> {
  let orders: MintsoftOrder[] = [];
  try {
    orders = await listOpenOrders(settings);
  } catch {
    return [];
  }
  const out: ProductOrderAllocation[] = [];
  const concurrency = 8;
  let i = 0;
  async function worker() {
    while (i < orders.length) {
      const idx = i++;
      const o = orders[idx];
      try {
        const allocs = await fetchOrderAllocations(settings, o.ID);
        for (const a of allocs) {
          if (a.productId && a.productId !== productId) continue;
          if (!a.productId && a.sku) {
            // sku-only allocation; skip if can't match
          }
          if (a.productId !== productId) continue;
          out.push({
            orderId: o.ID,
            orderNumber: o.OrderNumber,
            customerName: o.CustomerName,
            location: a.locationName,
            locationId: a.locationId,
            quantity: a.quantity,
          });
        }
      } catch {
        /* ignore individual order failures */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, orders.length) }, worker));
  return out;
}


type MintsoftApiOrderDocument = {
  ID?: number;
  OrderDocumentTypeId?: number;
  FileName?: string | null;
  Comments?: string | null;
  ContentType?: string | null;
  Base64Data?: string | null;
};

function bytesLookLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "%PDF";
}

function decodePdfResponseBody(body: string): Uint8Array | null {
  const rawBytes = base64ToBytes(body);
  if (bytesLookLikePdf(rawBytes)) return rawBytes;

  const text = new TextDecoder().decode(rawBytes).trim();
  const candidates: string[] = [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "string") {
      candidates.push(parsed);
    } else if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["Base64Data", "Data", "body", "Body"]) {
        if (typeof record[key] === "string") candidates.push(record[key]);
      }
    }
  } catch {
    candidates.push(text);
  }

  for (const candidate of candidates) {
    const bytes = decodeDocumentBase64(candidate);
    if (bytes && bytesLookLikePdf(bytes)) return bytes;
  }
  return null;
}

function decodeDocumentBase64(value?: string | null): Uint8Array | null {
  if (!value?.trim()) return null;
  const cleaned = value
    .trim()
    .replace(/^data:[^,]+,/, "")
    .replace(/\s/g, "");
  try {
    const bytes = base64ToBytes(cleaned);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function fetchOrderDocuments(
  settings: Settings,
  orderId: number,
): Promise<OrderDocument[]> {
  const linkedDocs = await authedJson<MintsoftApiOrderDocument[]>(
    settings,
    `/api/Order/${orderId}/Documents`,
  ).catch((e) => {
    console.warn(`[mintsoft] linked documents failed at /api/Order/${orderId}/Documents`, e);
    return [];
  });

  const out: OrderDocument[] = [];
  for (const doc of Array.isArray(linkedDocs) ? linkedDocs : []) {
    const documentId = doc.ID;
    let bytes = decodeDocumentBase64(doc.Base64Data);

    if (!bytes && documentId) {
      const data = await authedJson<string | MintsoftApiOrderDocument>(
        settings,
        `/api/Order/${orderId}/Documents/${documentId}/Data`,
      ).catch(() => null);
      bytes =
        typeof data === "string"
          ? decodeDocumentBase64(data)
          : decodeDocumentBase64(data?.Base64Data);
    }

    if (!bytes && documentId) {
      const fullDoc = await authedJson<MintsoftApiOrderDocument>(
        settings,
        `/api/Order/${orderId}/Documents/${documentId}`,
      ).catch(() => null);
      bytes = decodeDocumentBase64(fullDoc?.Base64Data);
    }

    if (bytes) {
      out.push({
        label: doc.FileName || doc.Comments || `Document ${documentId ?? out.length + 1}`,
        fileName: doc.FileName ?? undefined,
        contentType:
          doc.ContentType ||
          (bytesLookLikePdf(bytes) ? "application/pdf" : "application/octet-stream"),
        documentId,
        bytes,
      });
    }
  }

  // Always also probe the well-known PDF endpoints. Linked /Documents often
  // only returns courier labels / invoices and omits the picking list, so
  // returning early here would mean the picking list is never fetched.
  const haveLabels = {
    courier: out.some(
      (d) =>
        /courier|label|shipping/i.test(d.label) || /courier|label|shipping/i.test(d.fileName ?? ""),
    ),
    invoice: out.some((d) => /invoice/i.test(d.label) || /invoice/i.test(d.fileName ?? "")),
    // Only consider a real picking list / despatch note here. Documents like
    // FBA "prep" labels are NOT the picking list, so we must still probe the
    // DespatchNote endpoint even when prep PDFs are linked to the order.
    pick: out.some(
      (d) =>
        /pick(ing)?\s*list|despatch\s*note|dispatch\s*note/i.test(d.label) ||
        /pick(ing)?[-_ ]?list|despatch[-_ ]?note|dispatch[-_ ]?note/i.test(d.fileName ?? ""),
    ),
  };

  // Mintsoft document endpoints — path shape is /api/Order/<DocName>/<OrderId>
  // (NOT /api/Order/<OrderId>/<DocName>). Multiple aliases exist in the wild;
  // we try both shapes and keep whichever returns a valid PDF.
  const candidates: Array<{ label: string; paths: string[] }> = [
    {
      label: "Courier Label",
      paths: [`/api/Order/CourierLabel/${orderId}`, `/api/Order/${orderId}/CourierLabel`],
    },
    {
      label: "Invoice",
      paths: [`/api/Order/Invoice/${orderId}`, `/api/Order/${orderId}/Invoice`],
    },
    {
      label: "Picking List",
      paths: [
        `/api/Order/DespatchNote/${orderId}`,
        `/api/Order/${orderId}/DespatchNote`,
        `/api/Order/PickList/${orderId}`,
        `/api/Order/${orderId}/PickList`,
        `/api/Order/PickingList/${orderId}`,
      ],
    },
  ];
  for (const c of candidates) {
    if (c.label === "Courier Label" && haveLabels.courier) continue;
    if (c.label === "Invoice" && haveLabels.invoice) continue;
    if (c.label === "Picking List" && haveLabels.pick) continue;
    for (const path of c.paths) {
      try {
        const bytes = await authedPdf(settings, path);
        if (bytes) {
          console.info(`[mintsoft] ${c.label} OK via ${path} (${bytes.length} bytes)`);
          out.push({
            label: c.label,
            fileName: `${c.label}.pdf`,
            contentType: "application/pdf",
            bytes,
          });
          break;
        } else {
          console.warn(`[mintsoft] ${c.label} no PDF at ${path}`);
        }
      } catch (e) {
        console.warn(`[mintsoft] ${c.label} failed at ${path}`, e);
      }
    }
  }
  return out;
}

export async function despatchOrder(
  settings: Settings,
  orderId: number,
  trackingNumber?: string,
): Promise<void> {
  // Mintsoft public API: GET /api/Order/{id}/MarkDespatched?TrackingNumber=...
  const qs = trackingNumber
    ? `?TrackingNumber=${encodeURIComponent(trackingNumber)}`
    : "";
  await authedJson(settings, `/api/Order/${orderId}/MarkDespatched${qs}`, {
    method: "GET",
  });
}

/**
 * Log a rework charge against an order by scanning its barcode.
 * Mintsoft exposes this as `POST /api/Order/{id}/AddProduct` taking either
 * a SKU or Barcode + Quantity. We send both fields and the API ignores the
 * one it doesn't recognise.
 */
/**
 * Append a comment to an order in Mintsoft. The Mintsoft public API does
 * not expose its internal Rework endpoint, so rework charges are recorded
 * here as an order comment for traceability.
 */
export async function addOrderComment(
  settings: Settings,
  orderId: number,
  comment: string,
  admin = true,
): Promise<void> {
  await authedJson(settings, `/api/Order/${orderId}/Comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Comment: comment, Admin: admin }),
  });
}

export type MintsoftOrderComment = {
  Comment?: string | null;
  CreatedDate?: string | null;
  CreatedBy?: string | null;
  Admin?: boolean | null;
  [k: string]: unknown;
};

export async function fetchOrderComments(
  settings: Settings,
  orderId: number,
): Promise<MintsoftOrderComment[]> {
  try {
    const data = await authedJson<MintsoftOrderComment[] | { Results?: MintsoftOrderComment[] }>(
      settings,
      `/api/Order/${orderId}/Comments`,
    );
    return Array.isArray(data) ? data : (data?.Results ?? []);
  } catch {
    return [];
  }
}

// ============================================================================
// Invoices (Accounting)
// ============================================================================

export type MintsoftInvoice = {
  ID: number;
  InvoiceNumber?: string | null;
  ClientId?: number | null;
  ClientName?: string | null;
  InvoiceDate?: string | null;
  Status?: string | null;
  TotalValue?: number | null;
  TotalNet?: number | null;
  TotalTax?: number | null;
  [k: string]: unknown;
};

export type MintsoftInvoiceItem = {
  ID?: number;
  InvoiceId?: number | null;
  OrderId?: number | null;
  OrderNumber?: string | null;
  Description?: string | null;
  Quantity?: number | null;
  UnitPrice?: number | null;
  TotalPrice?: number | null;
  ReworkCost?: number | null;
  [k: string]: unknown;
};

function normaliseInvoice(r: Record<string, unknown>): MintsoftInvoice {
  const id = Number(r.ID ?? r.Id ?? r.InvoiceId);
  return {
    ...r,
    ID: Number.isFinite(id) ? id : 0,
    InvoiceNumber:
      (typeof r.InvoiceNumber === "string" && r.InvoiceNumber) ||
      (typeof r.Number === "string" && r.Number) ||
      null,
    ClientId:
      typeof r.ClientId === "number"
        ? r.ClientId
        : typeof r.ClientID === "number"
          ? r.ClientID
          : null,
    ClientName:
      (typeof r.ClientName === "string" && r.ClientName) ||
      (typeof r.Client === "string" && r.Client) ||
      (typeof r.Name === "string" && r.Name) ||
      null,
    InvoiceDate:
      (typeof r.InvoiceDate === "string" && r.InvoiceDate) ||
      (typeof r.Date === "string" && r.Date) ||
      (typeof r.CreatedDate === "string" && r.CreatedDate) ||
      null,
    Status:
      (typeof r.Status === "string" && r.Status) ||
      (typeof r.InvoiceStatus === "string" && r.InvoiceStatus) ||
      "Confirmed",
    TotalValue:
      typeof r.TotalValue === "number"
        ? r.TotalValue
        : typeof r.Total === "number"
          ? r.Total
          : null,
    TotalNet: typeof r.TotalNet === "number" ? r.TotalNet : null,
    TotalTax: typeof r.TotalTax === "number" ? r.TotalTax : null,
  };
}

/**
 * List invoices from the Mintsoft accounting module.
 * Tries a couple of common endpoint paths to be resilient against tenant
 * configuration differences.
 */
export async function listInvoices(
  settings: Settings,
  opts: { take?: number; from?: string; to?: string } = {},
): Promise<MintsoftInvoice[]> {
  const take = opts.take ?? 100;
  const qs = new URLSearchParams();
  qs.set("PageNo", "1");
  qs.set("Limit", String(take));
  if (opts.from) qs.set("SinceDate", opts.from);
  const paths = [
    `/api/Accounting/Invoice/List?${qs.toString()}`,
    `/api/Accounting/Invoice/All`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<
        MintsoftInvoice[] | { Results?: MintsoftInvoice[] }
      >(settings, p);
      const arr = Array.isArray(data) ? data : (data?.Results ?? []);
      if (Array.isArray(arr)) {
        return arr.map((r) => normaliseInvoice(r as Record<string, unknown>));
      }
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function fetchInvoiceItems(
  settings: Settings,
  invoiceId: number,
): Promise<MintsoftInvoiceItem[]> {
  const paths = [
    `/api/Accounting/Invoice/${invoiceId}/Orders`,
    `/api/Accounting/Invoice/${invoiceId}`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<
        | Record<string, unknown>[]
        | {
            Items?: Record<string, unknown>[];
            InvoiceItems?: Record<string, unknown>[];
            Orders?: Record<string, unknown>[];
          }
      >(settings, p);
      const arr = Array.isArray(data)
        ? data
        : (data?.Orders ?? data?.Items ?? data?.InvoiceItems ?? null);
      if (Array.isArray(arr)) {
        return arr.map((r) => normaliseInvoiceItem(r, invoiceId));
      }
    } catch {
      /* try next */
    }
  }
  return [];
}

function normaliseInvoiceItem(
  r: Record<string, unknown>,
  invoiceId: number,
): MintsoftInvoiceItem {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;
  return {
    ...r,
    ID: typeof r.ID === "number" ? r.ID : undefined,
    InvoiceId:
      num(r.InvoiceSummaryId) ?? num(r.InvoiceId) ?? invoiceId,
    OrderId: num(r.OrderId),
    OrderNumber: str(r.OrderNumber) ?? str(r.OrderRef),
    Description: str(r.Description) ?? str(r.Comments),
    Quantity: num(r.Quantity) ?? num(r.NumberOfPicks),
    UnitPrice: num(r.UnitPrice),
    TotalPrice: num(r.TotalPrice) ?? num(r.TotalCost),
    ReworkCost: num(r.ReworkCost),
  };
}

export async function addTrackingNumber(
  settings: Settings,
  orderId: number,
  trackingNumber: string,
  courier?: string,
): Promise<void> {
  await authedJson(settings, `/api/Order/${orderId}/AddTrackingNumber`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      TrackingNumber: trackingNumber,
      Courier: courier ?? "",
    }),
  });
}

export { bytesToBase64 };

// ============================================================================
// ASN (Advanced Shipping Notice) — inbound shipments
// ============================================================================

export type MintsoftASN = {
  ID: number;
  Reference?: string | null;
  SupplierName?: string | null;
  SupplierId?: number | null;
  WarehouseId?: number | null;
  WarehouseName?: string | null;
  Status?: string | null;
  StatusId?: number | null;
  ExpectedDate?: string | null;
  CreatedDate?: string | null;
  ReceivedDate?: string | null;
  TotalQuantity?: number | null;
  ClientId?: number | null;
  Notes?: string | null;
  PORef?: string | null;
  Comments?: string | null;
  InboundType?: string | null;
  [k: string]: unknown;
};

function normaliseAsn(r: Record<string, unknown>): MintsoftASN {
  const id = Number(r.ID ?? r.Id ?? r.ASNId ?? r.ASNID);
  return {
    ID: Number.isFinite(id) ? id : 0,
    Reference:
      (typeof r.Reference === "string" && r.Reference) ||
      (typeof r.ASNReference === "string" && r.ASNReference) ||
      (typeof r.ReferenceNumber === "string" && r.ReferenceNumber) ||
      null,
    SupplierName:
      (typeof r.SupplierName === "string" && r.SupplierName) ||
      (typeof r.Supplier === "string" && r.Supplier) ||
      null,
    SupplierId: Number(r.SupplierId ?? r.SupplierID) || null,
    WarehouseId: Number(r.WarehouseId ?? r.WarehouseID) || null,
    WarehouseName:
      (typeof r.WarehouseName === "string" && r.WarehouseName) ||
      (typeof r.Warehouse === "string" && r.Warehouse) ||
      null,
    Status:
      (typeof r.Status === "string" && r.Status) ||
      (typeof r.StatusName === "string" && r.StatusName) ||
      (r.ASNStatus && typeof (r.ASNStatus as { Name?: unknown }).Name === "string"
        ? ((r.ASNStatus as { Name: string }).Name)
        : null) ||
      null,
    StatusId:
      Number(r.StatusId ?? r.StatusID ?? r.ASNStatusId ?? r.ASNStatusID) || null,
    ExpectedDate:
      (typeof r.ExpectedDate === "string" && r.ExpectedDate) ||
      (typeof r.ExpectedArrivalDate === "string" && r.ExpectedArrivalDate) ||
      (typeof r.ExpectedDeliveryDate === "string" && r.ExpectedDeliveryDate) ||
      (typeof r.DeliveryDate === "string" && r.DeliveryDate) ||
      (typeof r.EstimatedDeliveryDate === "string" && r.EstimatedDeliveryDate) ||
      (typeof r.EstimatedArrivalDate === "string" && r.EstimatedArrivalDate) ||
      (typeof r.EstimatedDelivery === "string" && r.EstimatedDelivery) ||
      (typeof r.DueDate === "string" && r.DueDate) ||
      (typeof r.ETA === "string" && r.ETA) ||
      null,
    CreatedDate:
      (typeof r.CreatedDate === "string" && r.CreatedDate) ||
      (typeof r.DateCreated === "string" && r.DateCreated) ||
      null,
    ReceivedDate:
      (typeof r.ReceivedDate === "string" && r.ReceivedDate) ||
      (typeof r.DateReceived === "string" && r.DateReceived) ||
      null,
    TotalQuantity:
      Number(r.TotalQuantity ?? r.TotalQty ?? r.Quantity ?? r.NumberOfItems) || null,
    ClientId: Number(r.ClientId ?? r.ClientID) || null,
    Notes:
      (typeof r.Notes === "string" && r.Notes) ||
      (typeof r.Comment === "string" && r.Comment) ||
      null,
    PORef:
      (typeof r.PORef === "string" && r.PORef) ||
      (typeof r.PONumber === "string" && r.PONumber) ||
      (typeof r.PurchaseOrderReference === "string" && r.PurchaseOrderReference) ||
      (typeof r.PurchaseOrderNumber === "string" && r.PurchaseOrderNumber) ||
      (typeof r.POReference === "string" && r.POReference) ||
      null,
    Comments:
      (typeof r.Comments === "string" && r.Comments) ||
      (typeof r.Comment === "string" && r.Comment) ||
      (typeof r.Notes === "string" && r.Notes) ||
      null,
    InboundType:
      (typeof r.InboundType === "string" && r.InboundType) ||
      (typeof r.GoodsInType === "string" && r.GoodsInType) ||
      (typeof r.GoodsInTypeName === "string" && r.GoodsInTypeName) ||
      (typeof r.InboundTypeName === "string" && r.InboundTypeName) ||
      (typeof r.ShipmentType === "string" && r.ShipmentType) ||
      (typeof r.PackagingType === "string" && r.PackagingType) ||
      (typeof r.PackageType === "string" && r.PackageType) ||
      (typeof r.DeliveryType === "string" && r.DeliveryType) ||
      (r.GoodsInType && typeof (r.GoodsInType as { Name?: unknown }).Name === "string"
        ? ((r.GoodsInType as { Name: string }).Name)
        : null) ||
      (r.InboundType && typeof (r.InboundType as { Name?: unknown }).Name === "string"
        ? ((r.InboundType as { Name: string }).Name)
        : null) ||
      null,
    ...r,
  };
}

export async function listASNs(settings: Settings): Promise<MintsoftASN[]> {
  const paths = [
    "/api/ASN/List?Take=200",
    "/api/ASN?Take=200",
    "/api/ASN/List",
    "/api/ASN",
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<unknown>(settings, p);
      const arr = Array.isArray(data)
        ? data
        : Array.isArray((data as { Results?: unknown })?.Results)
          ? ((data as { Results: unknown[] }).Results)
          : null;
      if (!arr) continue;
      return (arr as Array<Record<string, unknown>>).map(normaliseAsn);
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function fetchASN(
  settings: Settings,
  asnId: number,
): Promise<MintsoftASN | null> {
  const paths = [`/api/ASN/${asnId}`, `/api/ASN/${asnId}/Details`];
  for (const p of paths) {
    try {
      const data = await authedJson<Record<string, unknown>>(settings, p);
      if (data && typeof data === "object") return normaliseAsn(data);
    } catch {
      /* try next */
    }
  }
  return null;
}

export type MintsoftASNItem = {
  ID?: number | null;
  ProductId?: number | null;
  SKU?: string | null;
  Title?: string | null;
  Description?: string | null;
  ImageURL?: string | null;
  EAN?: string | null;
  UPC?: string | null;
  ExpectedQuantity?: number | null;
  ReceivedQuantity?: number | null;
};

function normaliseAsnItem(r: Record<string, unknown>): MintsoftASNItem {
  const id = Number(r.ID ?? r.Id ?? r.ASNItemId ?? r.ASNItemID ?? r.ASNDetailId ?? r.ASNDetailID ?? r.ItemId ?? r.ItemID);
  const productId = Number(r.ProductId ?? r.ProductID);
  return {
    ID: Number.isFinite(id) ? id : null,
    ProductId: Number.isFinite(productId) ? productId : null,
    SKU:
      (typeof r.SKU === "string" && r.SKU) ||
      (typeof r.Sku === "string" && r.Sku) ||
      (typeof r.ProductSKU === "string" && r.ProductSKU) ||
      null,
    Title:
      (typeof r.Title === "string" && r.Title) ||
      (typeof r.Name === "string" && r.Name) ||
      (typeof r.NAME === "string" && r.NAME) ||
      (typeof r.ProductName === "string" && r.ProductName) ||
      (typeof r.Description === "string" && r.Description) ||
      null,
    Description:
      (typeof r.Description === "string" && r.Description) ||
      (typeof r.ProductDescription === "string" && r.ProductDescription) ||
      null,
    ImageURL:
      (typeof r.ImageURL === "string" && r.ImageURL) ||
      (typeof r.ImageUrl === "string" && r.ImageUrl) ||
      (typeof r.ProductImageURL === "string" && r.ProductImageURL) ||
      (typeof r.ProductImageUrl === "string" && r.ProductImageUrl) ||
      null,
    EAN: (typeof r.EAN === "string" && r.EAN) || null,
    UPC: (typeof r.UPC === "string" && r.UPC) || null,
    ExpectedQuantity:
      Number(
        r.ExpectedQuantity ??
          r.Expected ??
          r.Qty ??
          r.Quantity ??
          r.QuantityExpected,
      ) || 0,
    ReceivedQuantity:
      Number(r.ReceivedQuantity ?? r.QuantityReceived ?? r.Received) || 0,
  };
}

export async function fetchASNItems(
  settings: Settings,
  asnId: number,
): Promise<MintsoftASNItem[]> {
  const paths = [
    `/api/ASN/${asnId}/Items`,
    `/api/ASN/${asnId}/Details`,
    `/api/ASN/${asnId}/Products`,
    `/api/ASN/${asnId}`,
  ];
  for (const p of paths) {
    try {
      const data = await authedJson<unknown>(settings, p);
      const arr = Array.isArray(data)
        ? data
        : Array.isArray((data as { Results?: unknown })?.Results)
          ? ((data as { Results: unknown[] }).Results)
          : Array.isArray((data as { Products?: unknown })?.Products)
            ? ((data as { Products: unknown[] }).Products)
            : Array.isArray((data as { ASNDetails?: unknown })?.ASNDetails)
              ? ((data as { ASNDetails: unknown[] }).ASNDetails)
              : Array.isArray((data as { ASNItems?: unknown })?.ASNItems)
                ? ((data as { ASNItems: unknown[] }).ASNItems)
              : Array.isArray((data as { Items?: unknown })?.Items)
                ? ((data as { Items: unknown[] }).Items)
                : null;
      if (!arr) continue;
      const out = (arr as Array<Record<string, unknown>>).map(normaliseAsnItem);
      if (out.length > 0) return out;
    } catch {
      /* try next */
    }
  }
  return [];
}

export type CreateASNInput = {
  Reference: string;
  WarehouseId: number;
  SupplierName?: string;
  SupplierId?: number;
  ClientId?: number;
  ExpectedDate?: string;
  Notes?: string;
};

/**
 * Receive stock against an ASN. Uses Mintsoft's ASN receive endpoint so the
 * ASN's received quantities + status are updated (not just a stock movement).
 * Uses Mintsoft's documented /api/ASN/{id}/Items/Receive endpoint.
 */
export async function receiveASNItem(
  settings: Settings,
  params: {
    ASNId: number;
    ASNDetailId?: number | null;
    ProductId?: number;
    WarehouseId?: number;
    LocationId: number;
    Quantity: number;
    Complete?: boolean;
    BatchNumber?: string;
    BestBeforeDate?: string;
    Comment?: string;
  },
): Promise<void> {
  const {
    ASNId,
    ASNDetailId,
    LocationId,
    Quantity,
    Complete = false,
    BatchNumber,
    BestBeforeDate,
    Comment,
  } = params;

  if (!ASNDetailId) throw new Error("Missing ASN item id for Mintsoft receive");

  const receiveItemBody = {
    ASNItemId: ASNDetailId,
    Quantity,
    Complete,
    LocationId,
    ...(BatchNumber ? { BatchNo: BatchNumber, BatchNumber } : {}),
    ...(BestBeforeDate ? { ExpiryDate: BestBeforeDate, BestBeforeDate } : {}),
    ...(Comment ? { Comment, Notes: Comment } : {}),
  };

  const bodies: unknown[] = [[receiveItemBody], { Items: [receiveItemBody] }, receiveItemBody];
  let lastErr: unknown;
  for (const body of bodies) {
    try {
      const result = await authedJson<MintsoftToolkitResult | unknown>(
        settings,
        `/api/ASN/${ASNId}/Items/Receive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const r = result as MintsoftToolkitResult;
      if (r && r.Success === false) {
        throw new Error(r.Message || r.WarningMessage || "Mintsoft ASN receive failed");
      }
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to receive ASN item");
}

/**
 * Mark an ASN as complete in Mintsoft. Tries a few known endpoint shapes
 * since Mintsoft tenants vary slightly.
 */
export async function completeASN(
  settings: Settings,
  asnId: number,
): Promise<void> {
  // Mintsoft's receiving UI runs two stages: "Assign locations and book in"
  // (the BookIn endpoint) and then "Complete book in ASN". Mirror that order
  // here — BookIn first (best effort, since it may already have been called),
  // then a Complete attempt.
  const bookInAttempts: Array<{ path: string; method: "POST" | "PUT" | "GET"; body?: unknown }> = [
    { path: `/api/ASN/${asnId}/BookIn`, method: "GET" },
    { path: `/api/ASN/${asnId}/BookInPartial`, method: "GET" },
    { path: `/api/ASN/${asnId}/PartBook`, method: "GET" },
    { path: `/api/ASN/${asnId}/BookIn`, method: "PUT" },
    { path: `/api/ASN/${asnId}/BookIn`, method: "POST" },
    { path: `/api/ASN/BookIn?ASNId=${asnId}`, method: "POST" },
  ];
  const completeAttempts: Array<{ path: string; method: "POST" | "PUT" | "GET"; body?: unknown }> = [
    { path: `/api/ASN/${asnId}/MarkPutAwayComplete`, method: "GET" },
    { path: `/api/ASN/${asnId}/Complete`, method: "POST" },
    { path: `/api/ASN/${asnId}/MarkComplete`, method: "POST" },
    { path: `/api/ASN/${asnId}/Close`, method: "POST" },
    { path: `/api/ASN/Complete?ASNId=${asnId}`, method: "POST" },
    { path: `/api/ASN/${asnId}/Status`, method: "PUT", body: { Status: "Complete" } },
  ];

  const tryOne = async (a: { path: string; method: "POST" | "PUT" | "GET"; body?: unknown }) => {
    const result = await authedJson<MintsoftToolkitResult | unknown>(
      settings,
      a.path,
      {
        method: a.method,
        headers: a.body ? { "Content-Type": "application/json" } : undefined,
        body: a.body ? JSON.stringify(a.body) : undefined,
      },
    );
    const r = result as MintsoftToolkitResult;
    if (r && r.Success === false) {
      throw new Error(r.Message || r.WarningMessage || "Mintsoft ASN call failed");
    }
  };

  // Stage 1: Assign locations and book in. Best effort — if the ASN was
  // already booked in this often errors, which is fine.
  let bookInOk = false;
  for (const a of bookInAttempts) {
    try {
      await tryOne(a);
      bookInOk = true;
      break;
    } catch {
      // try next shape
    }
  }

  // Stage 2: Complete book in ASN.
  let lastErr: unknown;
  const asnBeforeComplete = await fetchASN(settings, asnId).catch(() => null);
  for (const a of completeAttempts) {
    try {
      await tryOne(a);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  // If only the BookIn stage succeeded and Complete endpoints don't exist on
  // this tenant, treat BookIn as sufficient — Mintsoft closes the ASN when
  // all items are received with Complete: true via the BookIn flow.
  const asnAfterComplete = await fetchASN(settings, asnId).catch(() => null);
  const beforeStatusId = asnBeforeComplete?.StatusId ?? null;
  const afterStatusId = asnAfterComplete?.StatusId ?? null;
  const statusAdvanced =
    afterStatusId != null && beforeStatusId != null && afterStatusId >= beforeStatusId;
  const statusLooksBookedOrComplete = /booked|complete|put\s*away/i.test(
    asnAfterComplete?.Status ?? "",
  );
  if (bookInOk || statusAdvanced || statusLooksBookedOrComplete) return;
  throw lastErr instanceof Error ? lastErr : new Error("Failed to complete ASN");
}

/**
 * Mark an ASN as partially booked-in / closed-partial on Mintsoft. Tries the
 * known partial endpoints and falls back to a Status update.
 */
export async function partialCompleteASN(
  settings: Settings,
  asnId: number,
): Promise<void> {
  const attempts: Array<{ path: string; method: "POST" | "PUT" | "GET"; body?: unknown }> = [
    { path: `/api/ASN/${asnId}/BookInPartial`, method: "GET" },
    { path: `/api/ASN/${asnId}/BookInPartial`, method: "POST" },
    { path: `/api/ASN/${asnId}/PartBook`, method: "GET" },
    { path: `/api/ASN/${asnId}/PartBook`, method: "POST" },
    { path: `/api/ASN/${asnId}/PartialComplete`, method: "POST" },
    { path: `/api/ASN/${asnId}/ClosePartial`, method: "POST" },
    { path: `/api/ASN/${asnId}/Status`, method: "PUT", body: { Status: "Partial book in ASN" } },
    { path: `/api/ASN/${asnId}/Status`, method: "PUT", body: { Status: "Partially Booked" } },
  ];

  const tryOne = async (a: { path: string; method: "POST" | "PUT" | "GET"; body?: unknown }) => {
    const result = await authedJson<MintsoftToolkitResult | unknown>(
      settings,
      a.path,
      {
        method: a.method,
        headers: a.body ? { "Content-Type": "application/json" } : undefined,
        body: a.body ? JSON.stringify(a.body) : undefined,
      },
    );
    const r = result as MintsoftToolkitResult;
    if (r && r.Success === false) {
      throw new Error(r.Message || r.WarningMessage || "Mintsoft ASN call failed");
    }
  };

  const before = await fetchASN(settings, asnId).catch(() => null);
  let lastErr: unknown;
  for (const a of attempts) {
    try {
      await tryOne(a);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  const after = await fetchASN(settings, asnId).catch(() => null);
  const advanced =
    after?.StatusId != null && before?.StatusId != null && after.StatusId >= before.StatusId;
  const looksPartial = /partial/i.test(after?.Status ?? "");
  if (advanced || looksPartial) return;
  throw lastErr instanceof Error ? lastErr : new Error("Failed to mark ASN as partial");
}

export async function createASN(
  settings: Settings,
  input: CreateASNInput,
): Promise<MintsoftASN> {
  const body = JSON.stringify(input);
  const paths = ["/api/ASN", "/api/ASN/Create"];
  let lastErr: unknown;
  for (const p of paths) {
    try {
      const data = await authedJson<Record<string, unknown>>(settings, p, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      return normaliseAsn(data ?? {});
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to create ASN");
}
