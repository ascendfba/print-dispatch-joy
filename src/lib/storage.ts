const KEY = "dispatch-settings-v1";

export type PrinterMap = {
  small: string; // 50x25mm
  large: string; // 100x150mm
  other: string; // A4 / fallback
};

export type ReworkMapping = {
  id: number;
  name: string;
  cost?: number;
};

// Per-client rework rates: { [clientId]: { [reworkKey]: ratePerUnit } }
// clientId "*" (or "0") acts as a default fallback when a client has no entry.
export type ReworkRates = Record<string, Record<string, number>>;

export type Settings = {
  mintsoftBaseUrl: string;
  mintsoftUsername: string;
  mintsoftPassword: string;
  mintsoftApiKey: string;
  printers: PrinterMap;
  silentPrint: boolean;
  reworkClientId: string;
  // Map keyed by rework barcode → Mintsoft Rework metadata.
  reworkMap: Record<string, ReworkMapping>;
  // Per-client rework charges (GBP per unit).
  reworkRates: ReworkRates;
  // URL where dispatch staff can download the Windows desktop app.
  desktopAppUrl: string;
};

export const defaultSettings: Settings = {
  mintsoftBaseUrl: "https://api.mintsoft.co.uk",
  mintsoftUsername: "",
  mintsoftPassword: "",
  mintsoftApiKey: "c895de8f-5f33-4d3c-be19-06d69aa1eea7",
  printers: { small: "", large: "", other: "" },
  silentPrint: true,
  reworkClientId: "",
  reworkMap: {},
  reworkRates: {},
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    // Always force baked-in Mintsoft credentials so they can't be overridden
    // by stale localStorage from previous sessions.
    return {
      ...defaultSettings,
      ...parsed,
      mintsoftBaseUrl: defaultSettings.mintsoftBaseUrl,
      mintsoftApiKey: defaultSettings.mintsoftApiKey,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: Settings) {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

const TOKEN_KEY = "mintsoft-token-v1";
export const tokenStore = {
  get: () => (typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => window.localStorage.setItem(TOKEN_KEY, t),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};