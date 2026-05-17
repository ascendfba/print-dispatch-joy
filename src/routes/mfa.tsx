import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/mfa")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : "/",
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: MfaPage,
});

function MfaPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = data?.totp?.find((f) => f.status === "verified");
      if (!totp) {
        navigate({ to: redirectTo });
        return;
      }
      setFactorId(totp.id);
    });
  }, [navigate, redirectTo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setLoading(true);
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr || !challenge) {
      setLoading(false);
      return toast.error(cErr?.message ?? "Could not start challenge");
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Verified");
    navigate({ to: redirectTo });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Two-factor authentication</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                />
                <p className="text-xs text-muted-foreground">
                  Open your authenticator app and enter the current code.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading ? "Verifying…" : "Verify"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate({ to: "/login" });
                }}
              >
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}