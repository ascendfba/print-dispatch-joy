export {};

declare global {
  interface Window {
    dispatchAPI?: {
      isElectron: true;
      listPrinters: () => Promise<string[]>;
      printPdf: (args: {
        base64: string;
        printerName: string;
        silent: boolean;
        pageSize?: { widthPt: number; heightPt: number };
      }) => Promise<{ ok: boolean; error?: string }>;
      printRasterPages: (args: {
        pages: Array<{ pngBase64: string; widthPt: number; heightPt: number }>;
        printerName: string;
        silent: boolean;
      }) => Promise<{ ok: boolean; error?: string }>;
      mintsoftFetch: (args: {
        baseUrl: string;
        path: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }) => Promise<{
        status: number;
        contentType: string;
        body: string; // base64
      }>;
    };
  }
}
