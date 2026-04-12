import i18n from "i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";

interface RepBreakdown {
  id: string;
  name: string;
  repId: string;
  soldCount: number;
  connectedCount: number;
  approvedCount: number;
  earnedDollars: number;
}

interface ManagerBreakdown {
  id: string;
  name: string;
  soldCount: number;
  connectedCount: number;
  approvedCount: number;
  earnedDollars: number;
}

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium text-sm">{value}</span>
    </div>
  );
}

export function TeamBreakdownByRepTable({ data, title = "Team Breakdown" }: { data: RepBreakdown[]; title?: string }) {
  const formatCurrency = (value: number) => 
    `$${value.toLocaleString(i18n.language === "es" ? "es-MX" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isMobile = useIsMobile();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No team members found
          </div>
        ) : isMobile ? (
          <div className="flex flex-col gap-3">
            {data.map((row) => (
              <Card key={row.id} data-testid={`card-rep-${row.id}`}>
                <CardContent className="p-3">
                  <div className="mb-2">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.repId}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <StatCell label="Sold" value={row.soldCount} />
                    <StatCell label="Connected" value={row.connectedCount} />
                    <StatCell label="Approved" value={row.approvedCount} />
                    <StatCell label="Earned" value={formatCurrency(row.earnedDollars)} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rep</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Connected</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id} data-testid={`row-rep-${row.id}`}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-muted-foreground">{row.repId}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{row.soldCount}</TableCell>
                    <TableCell className="text-right">{row.connectedCount}</TableCell>
                    <TableCell className="text-right">{row.approvedCount}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(row.earnedDollars)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TeamBreakdownByManagerTable({ data, title = "Manager Breakdown" }: { data: ManagerBreakdown[]; title?: string }) {
  const formatCurrency = (value: number) => 
    `$${value.toLocaleString(i18n.language === "es" ? "es-MX" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isMobile = useIsMobile();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No managers found
          </div>
        ) : isMobile ? (
          <div className="flex flex-col gap-3">
            {data.map((row) => (
              <Card key={row.id} data-testid={`card-manager-${row.id}`}>
                <CardContent className="p-3">
                  <div className="font-medium mb-2">{row.name}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <StatCell label="Sold" value={row.soldCount} />
                    <StatCell label="Connected" value={row.connectedCount} />
                    <StatCell label="Approved" value={row.approvedCount} />
                    <StatCell label="Earned" value={formatCurrency(row.earnedDollars)} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Manager</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Connected</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id} data-testid={`row-manager-${row.id}`}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{row.soldCount}</TableCell>
                    <TableCell className="text-right">{row.connectedCount}</TableCell>
                    <TableCell className="text-right">{row.approvedCount}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(row.earnedDollars)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
