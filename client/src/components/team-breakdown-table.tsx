import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

export function TeamBreakdownByRepTable({ data, title = "Team Breakdown" }: { data: RepBreakdown[]; title?: string }) {
  const formatCurrency = (value: number) => 
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
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
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No team members found
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
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
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function TeamBreakdownByManagerTable({ data, title = "Manager Breakdown" }: { data: ManagerBreakdown[]; title?: string }) {
  const formatCurrency = (value: number) => 
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
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
              {data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No managers found
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow key={row.id} data-testid={`row-manager-${row.id}`}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{row.soldCount}</TableCell>
                    <TableCell className="text-right">{row.connectedCount}</TableCell>
                    <TableCell className="text-right">{row.approvedCount}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(row.earnedDollars)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
