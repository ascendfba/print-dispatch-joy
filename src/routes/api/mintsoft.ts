import { createFileRoute } from "@tanstack/react-router";

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa is available in Workers/Edge runtime
  return btoa(bin);
}

export const Route = createFileRoute("/api/mintsoft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: {
          baseUrl?: string;
          path?: string;
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        };
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const { baseUrl, path, method = "GET", headers = {}, body } = payload;
        if (!baseUrl || !path) {
          return new Response("Missing baseUrl or path", { status: 400 });
        }
        // Block protocol-relative or absolute hijacks; only allow paths starting with /
        if (!path.startsWith("/")) {
          return new Response("path must start with /", { status: 400 });
        }
        const target = baseUrl.replace(/\/$/, "") + path;
        try {
          const upstream = await fetch(target, {
            method,
            headers,
            body: ["GET", "HEAD"].includes(method.toUpperCase()) ? undefined : body,
          });
          const buf = await upstream.arrayBuffer();
          return Response.json({
            status: upstream.status,
            contentType: upstream.headers.get("content-type") ?? "",
            body: bufToBase64(buf),
          });
        } catch (err) {
          return Response.json(
            {
              status: 599,
              contentType: "text/plain",
              body: btoa(
                "Proxy fetch failed: " +
                  (err instanceof Error ? err.message : String(err)),
              ),
            },
            { status: 200 },
          );
        }
      },
    },
  },
});