import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPrintHistory, clearPrintHistory } from "@/lib/print-history.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

type PrintRow = {
  id: string;
  created_at: string;
  printer: string;
  kind: string | null;
  label: string | null;
  order_id: string | null;
  byte_size: number | null;
  status: "success" | "error";
  error: string | null;
  source: "web" | "desktop";
};

export function PrintHistoryCard() {
  const fetchHistory = useServerFn(listPrintHistory);
  const clearAll = useServerFn(clearPrintHistory);
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["print-history"],
    queryFn: () => fetchHistory({ data: { limit: 200 } }) as Promise<PrintRow[]>,
  });

  const clearMut = useMutation({
    mutationFn: () => clearAll({}),
    onSuccess: () => {
      toast.success("Print history cleared");
      qc.invalidateQueries({ queryKey: ["print-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Print history</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Every print job sent from this account — desktop or browser.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={"mr-2 h-4 w-4 " + (isFetching ? "animate-spin" : "")} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("Clear all print history? This cannot be undone.")) clearMut.mutate();
            }}
            disabled={clearMut.isPending || rows.length === 0}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No prints logged yet. Print a label and it will appear here.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Printer</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {r.status === "success" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" /> OK
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-destructive"
                        title={r.error ?? ""}
                      >
                        <XCircle className="h-4 w-4" /> Error
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.printer}</TableCell>
                  <TableCell>{r.kind ?? "—"}</TableCell>
                  <TableCell>{r.order_id ?? r.label ?? "—"}</TableCell>
                  <TableCell className="text-xs uppercase text-muted-foreground">
                    {r.source}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {r.byte_size ? `${Math.round(r.byte_size / 1024)} KB` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}