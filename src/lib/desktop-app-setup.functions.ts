import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const ensureDesktopAppBucket = createServerFn({ method: "POST" }).handler(
  async () => {
    const { data: existing } = await supabaseAdmin.storage.getBucket("desktop-app");
    if (!existing) {
      const { error } = await supabaseAdmin.storage.createBucket("desktop-app", {
        public: true,
        fileSizeLimit: 500 * 1024 * 1024,
      });
      if (error) throw new Error(`createBucket: ${error.message}`);
    }
    return { ok: true };
  },
);
