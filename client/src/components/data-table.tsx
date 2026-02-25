import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";

interface Column<T> {
  key: string;
  header: string | (() => React.ReactNode);
  cell: (row: T) => React.ReactNode;
  className?: string;
}

interface MobileCardConfig<T> {
  title: (row: T) => React.ReactNode;
  subtitle?: (row: T) => React.ReactNode;
  fields: { label: string; render: (row: T) => React.ReactNode }[];
  actions?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  testId?: string;
  footer?: React.ReactNode;
  mobileCard?: MobileCardConfig<T>;
}

export function DataTable<T extends { id?: string }>({
  columns,
  data,
  isLoading,
  emptyMessage = "No data found",
  onRowClick,
  testId,
  footer,
  mobileCard,
}: DataTableProps<T>) {
  const isMobile = useIsMobile();

  if (isLoading) {
    if (isMobile && mobileCard) {
      return (
        <div className="space-y-3" data-testid={testId}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="rounded-md border" data-testid={testId}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {typeof col.header === "function" ? col.header() : col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3, 4, 5].map((i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center" data-testid={testId}>
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  if (isMobile && mobileCard) {
    return (
      <div className="space-y-3" data-testid={testId}>
        {data.map((row, idx) => (
          <div
            key={row.id || idx}
            className={`rounded-lg border p-4 space-y-2 bg-card ${onRowClick ? "cursor-pointer active-elevate" : ""}`}
            onClick={() => onRowClick?.(row)}
            data-testid={`card-${testId}-${row.id || idx}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{mobileCard.title(row)}</div>
                {mobileCard.subtitle && (
                  <div className="text-sm text-muted-foreground truncate">{mobileCard.subtitle(row)}</div>
                )}
              </div>
              {mobileCard.actions && (
                <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  {mobileCard.actions(row)}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {mobileCard.fields.map((field, fi) => (
                <div key={fi}>
                  <span className="text-muted-foreground text-xs">{field.label}</span>
                  <div className="font-medium">{field.render(row)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-md border" data-testid={testId}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} className={col.className}>
                {typeof col.header === "function" ? col.header() : col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, idx) => (
            <TableRow
              key={row.id || idx}
              className={onRowClick ? "cursor-pointer hover-elevate" : ""}
              onClick={() => onRowClick?.(row)}
              data-testid={`row-${testId}-${row.id || idx}`}
            >
              {columns.map((col) => (
                <TableCell key={col.key} className={col.className}>
                  {col.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {footer && <TableFooter>{footer}</TableFooter>}
      </Table>
    </div>
  );
}
