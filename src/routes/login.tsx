import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import ascendLogo from "@/assets/ascend-fba-logo-full.png";
import { deviceTrust, type TrustedDevice } from "@/lib/device-trust";
import { PinSetupDialog } from "@/components/PinSetupDialog";
import { KeyRound, Mail } from "lucide-react";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : "/",
  }),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session && !deviceTrust.isLocked(data.session.user.email)) {
      throw redirect({ to: search.redirect });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [trusted, setTrusted] = useState<TrustedDevice[]>([]);
  const [mode, setMode] = useState<"pin" | "password">("password");
  const [pinEmail, setPinEmail] = useState("");
  const [pin, setPin] = useState("");
  const [showPinSetup, setShowPinSetup] = useState(false);

  useEffect(() => {
    const list = deviceTrust.list();
    const lockedEmail = deviceTrust.lockedEmail();
    setTrusted(list);
    if (lockedEmail || list.length > 0) {
      setMode("pin");
      setPinEmail(lockedEmail ?? list[0].email);
    } else {
      // No trusted entries on this device/origin — make sure any stale lock
      // marker is cleared so we don't keep redirecting through PIN mode.
      deviceTrust.clearLock();
      setMode("password");
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    if (!data.session) {
      setLoading(false);
      return toast.error("Sign-in completed, but no session was returned. Please try again.");
    }
    setLoading(false);
    deviceTrust.clearLock();
    toast.success("Signed in");
    // Always offer to save fresh session tokens after a full sign-in. This
    // repairs any old trusted-device entry whose refresh token has rotated.
    setShowPinSetup(true);
  }

  async function onPinSubmit(e: FormEvent) {
    e.preventDefault();
    if (pin.length !== 4) return toast.error("Enter your 4-digit PIN");
    setLoading(true);
    try {
      const stored = await deviceTrust.unlock(pinEmail, pin);
      if (!stored.access_token || !stored.refresh_token) {
        deviceTrust.remove(pinEmail);
        throw new Error(
          "PIN session expired. Please sign in with email and password, then set your PIN again.",
        );
      }
      // Restore the encrypted session into Supabase storage. setSession refreshes
      // the access token if needed, then saves the usable session before routing.
      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });
      if (error || !data.session) {
        deviceTrust.remove(pinEmail);
        throw new Error(
          "PIN session expired. Please sign in with email and password, then set your PIN again.",
        );
      }
      const { data: verified, error: verifyError } = await supabase.auth.getUser();
      if (verifyError || !verified.user) {
        deviceTrust.remove(pinEmail);
        throw new Error(
          "PIN session could not be restored. Please sign in with email and password.",
        );
      }
      // Re-encrypt the new tokens so next PIN unlock has fresh ones.
      await deviceTrust.save({
        email: data.session.user.email ?? pinEmail,
        userId: data.session.user.id,
        pin,
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
      });
      deviceTrust.clearLock();
      toast.success("Signed in");
      navigate({ to: redirectTo });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not sign in";
      toast.error(message);
      // If the entry was removed or never existed on this device/origin,
      // drop back to email + password instead of getting stuck on a PIN
      // form that can never succeed.
      const remaining = deviceTrust.list();
      setTrusted(remaining);
      if (remaining.length === 0 || !deviceTrust.findByEmail(pinEmail)) {
        deviceTrust.clearLock();
        setPin("");
        setMode("password");
        setEmail(pinEmail);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <img src={ascendLogo} alt="Ascend FBA" className="h-14 w-auto" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{mode === "pin" ? "Enter your PIN" : "Sign in"}</CardTitle>
          </CardHeader>
          <CardContent>
            {mode === "pin" ? (
              <form onSubmit={onPinSubmit} className="space-y-4">
                {trusted.length > 1 ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="pinAccount">Account</Label>
                    <select
                      id="pinAccount"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={pinEmail}
                      onChange={(e) => setPinEmail(e.target.value)}
                    >
                      {trusted.map((t) => (
                        <option key={t.email} value={t.email}>
                          {t.email}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Signing in as <strong>{pinEmail}</strong>
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="pin">4-digit PIN</Label>
                  <Input
                    id="pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    required
                    autoFocus
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading || pin.length !== 4}>
                  {loading ? "Signing in…" : "Sign in with PIN"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setMode("password");
                    setPin("");
                  }}
                >
                  <Mail className="mr-2 h-4 w-4" /> Use email and password
                </Button>
              </form>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
                {trusted.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setMode("pin")}
                  >
                    <KeyRound className="mr-2 h-4 w-4" /> Use device PIN instead
                  </Button>
                )}
                <div className="flex justify-end text-sm">
                  <Link to="/forgot-password" className="text-muted-foreground hover:underline">
                    Forgot password?
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <PinSetupDialog
        open={showPinSetup}
        onOpenChange={(o) => {
          setShowPinSetup(o);
          if (!o) navigate({ to: redirectTo });
        }}
      />
    </div>
  );
}
