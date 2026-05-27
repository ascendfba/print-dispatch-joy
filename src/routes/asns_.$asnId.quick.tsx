import { requireAuth } from "@/lib/require-auth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Printer, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchASN, fetchASNItems } from "@/lib/mintsoft";
import { loadSettings } from "@/lib/storage";

export const Route = createFileRoute("/asns_/$asnId/quick")({
  beforeLoad: ({ location }) => requireAuth(location),
  component: QuickAsnPage,
});

function QuickAsnPage() {
  const { asnId: asnIdRaw } = Route.useParams();
  const asnId = Number(asnIdRaw);

  const asnQuery = useQuery({
    queryKey: ["asn", asnId],
    queryFn: () => fetchASN(loadSettings(), asnId),
    enabled: Number.isFinite(asnId) && asnId > 0,
  });

  const itemsQuery = useQuery({
    queryKey: ["asn-items", asnId],
    queryFn: () => fetchASNItems(loadSettings(), asnId),
    enabled: Number.isFinite(asnId) && asnId > 0,
  });

  const a = asnQuery.data;
  const items = itemsQuery.data ?? [];
  const totalExpected = items.reduce(
    (s, it) => s + (Number(it.ExpectedQuantity) || 0),
    0,
  );

  return (
    <div className="space-y-4 print:space-y-2">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/asns">
              <ArrowLeft className="h-4 w-4" /> ASNs
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Truck className="h-6 w-6" /> Quick ASN
          </h1>
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {a?.Reference || (a ? `#${a.ID}` : "ASN")}
            {a?.SupplierName ? (
              <span className="ml-2 text-muted-foreground font-normal">
                — {a.SupplierName}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {itemsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading items…
            </div>
          ) : itemsQuery.error ? (
            <div className="py-12 text-center text-sm text-destructive">
              {itemsQuery.error instanceof Error
                ? itemsQuery.error.message
                : "Failed to load items"}
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No items on this ASN.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">SKU</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-28 text-right">Expected</TableHead>
                  <TableHead className="w-28 text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, i) => (
                  <TableRow key={it.ID ?? `${it.SKU ?? "row"}-${i}`}>
                    <TableCell className="font-mono text-xs">
                      {it.SKU || "—"}
                    </TableCell>
                    <TableCell>{it.Title || it.Description || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {it.ExpectedQuantity ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {it.ReceivedQuantity ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell colSpan={2} className="text-right">
                    Total
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {totalExpected}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}