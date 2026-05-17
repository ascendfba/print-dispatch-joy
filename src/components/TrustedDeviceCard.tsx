import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { deviceTrust, type TrustedDevice } from "@/lib/device-trust";
import { PinSetupDialog } from "@/components/PinSetupDialog";
import { toast } from "sonner";

export function TrustedDeviceCard() {
  const [email, setEmail] = useState<string | null>(null);
  const [entry, setEntry] = useState<TrustedDevice | null>(null);
  const [open, setOpen] = useState(false);

  function refresh() {
    supabase.auth.getSession().then(({ data }) => {
      const e = data.session?.user.email ?? null;
      setEmail(e);
      setEntry(e ? deviceTrust.findByEmail(e) : null);
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  function removePin() {
    if (!email) return;
    if (!confirm("Remove PIN sign-in from this device?")) return;
    deviceTrust.remove(email);
    toast.success("PIN removed");
    refresh();
  }

  const expiresIn = entry
    ? Math.max(0, Math.ceil((entry.trustedUntil - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {entry ? (
              <ShieldCheck className="h-5 w-5 text-green-600" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" />
            )}
            Trusted device PIN
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {entry ? (
            <>
              <p className="text-sm text-muted-foreground">
                This device is trusted. You can sign in with your 4-digit PIN
                for the next <strong>{expiresIn} day{expiresIn === 1 ? "" : "s"}</strong>.
                After that you'll need your email and password again.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" /> Change PIN
                </Button>
                <Button variant="destructive" onClick={removePin}>
                  Remove PIN
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Set a 4-digit PIN to sign in faster on this device. Your session
                is encrypted on the device with your PIN and trusted for{" "}
                {deviceTrust.trustDays} days.
              </p>
              <Button onClick={() => setOpen(true)} disabled={!email}>
                <KeyRound className="mr-2 h-4 w-4" /> Set up PIN
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      <PinSetupDialog open={open} onOpenChange={setOpen} onDone={refresh} />
    </>
  );
}
