import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff } from "lucide-react";

type Enrollment = {
  factorId: string;
  qrSvg: string;
  secret: string;
};

export function TwoFactorCard() {
  const [loading, setLoading] = useState(true);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === "verified");
    setVerifiedFactorId(verified?.id ?? null);
    // Clean up any stale unverified factors so re-enrollment works.
    const stale = data?.totp?.filter((f) => f.status !== "verified") ?? [];
    for (const f of stale) await supabase.auth.mfa.unenroll({ factorId: f.id });
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function startEnroll() {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (error || !data) return toast.error(error?.message ?? "Could not start enrollment");
    setEnrollment({
      factorId: data.id,
      qrSvg: data.totp.qr_code,
      secret: data.totp.secret,
    });
    setCode("");
  }

  async function verifyEnroll() {
    if (!enrollment) return;
    setBusy(true);
    const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({
      factorId: enrollment.factorId,
    });
    if (cErr || !ch) {
      setBusy(false);
      return toast.error(cErr?.message ?? "Challenge failed");
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: ch.id,
      code,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Two-factor enabled");
    setEnrollment(null);
    setCode("");
    await refresh();
  }

  async function cancelEnroll() {
    if (!enrollment) return;
    await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setCode("");
  }

  async function disable() {
    if (!verifiedFactorId) return;
    if (!confirm("Disable two-factor authentication?")) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactorId });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Two-factor disabled");
    await refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {verifiedFactorId ? (
            <ShieldCheck className="h-5 w-5 text-green-600" />
          ) : (
            <ShieldOff className="h-5 w-5 text-muted-foreground" />
          )}
          Two-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : verifiedFactorId ? (
          <>
            <p className="text-sm text-muted-foreground">
              2FA is <strong>enabled</strong>. You'll be asked for a 6-digit code from your
              authenticator app on every sign-in.
            </p>
            <Button variant="destructive" onClick={disable} disabled={busy}>
              Disable 2FA
            </Button>
          </>
        ) : enrollment ? (
          <>
            <p className="text-sm text-muted-foreground">
              Scan this QR code with Google Authenticator, Authy, 1Password, or any TOTP
              app, then enter the 6-digit code it shows.
            </p>
            <div
              className="mx-auto w-48 [&_svg]:w-full [&_svg]:h-auto bg-white p-2 rounded"
              dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }}
            />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Or enter this secret manually</Label>
              <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                {enrollment.secret}
              </code>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enrollCode">Verification code</Label>
              <Input
                id="enrollCode"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={verifyEnroll} disabled={busy || code.length !== 6}>
                {busy ? "Verifying…" : "Verify & enable"}
              </Button>
              <Button variant="outline" onClick={cancelEnroll} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Add a second step to sign-in using an authenticator app (Google Authenticator,
              Authy, 1Password, etc.). Even if someone learns your password, they won't be
              able to sign in without your phone.
            </p>
            <Button onClick={startEnroll} disabled={busy}>
              {busy ? "Starting…" : "Enable 2FA"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}