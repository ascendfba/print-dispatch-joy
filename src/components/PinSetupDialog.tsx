import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { deviceTrust } from "@/lib/device-trust";

/**
 * Modal that asks the signed-in user to set a 4-digit PIN to unlock this
 * device for the next 30 days. Opens after first sign-in if no PIN exists
 * for the current account on this device.
 */
export function PinSetupDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPin("");
      setConfirm("");
    }
  }, [open]);

  async function save() {
    if (pin.length !== 4) return toast.error("PIN must be 4 digits");
    if (pin !== confirm) return toast.error("PINs don't match");
    setBusy(true);
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session?.user.email) {
      setBusy(false);
      return toast.error("Not signed in");
    }
    try {
      await deviceTrust.save({
        email: session.user.email,
        userId: session.user.id,
        pin,
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        },
      });
      toast.success("PIN saved — this device is trusted for 30 days");
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save PIN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set a 4-digit PIN</DialogTitle>
          <DialogDescription>
            Next time you sign in on this device, you can use this PIN instead
            of your email and password for the next {deviceTrust.trustDays} days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pin">PIN</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{4}"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pin2">Confirm PIN</Label>
            <Input
              id="pin2"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{4}"
              maxLength={4}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Skip
          </Button>
          <Button onClick={save} disabled={busy || pin.length !== 4 || confirm.length !== 4}>
            {busy ? "Saving…" : "Save PIN"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
