import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { deviceTrust } from "@/lib/device-trust";

export async function requireAuth(location?: { href: string }) {
  const { data } = await supabase.auth.getSession();
  if (!data.session || deviceTrust.isLocked(data.session.user.email)) {
    throw redirect({
      to: "/login",
      search: location ? { redirect: location.href } : undefined,
    });
  }
  // Enforce 2FA step-up if user has a verified TOTP factor.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2") {
    throw redirect({
      to: "/mfa",
      search: location ? { redirect: location.href } : undefined,
    });
  }
}
