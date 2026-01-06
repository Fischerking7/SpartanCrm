import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Phone, MapPin, User } from "lucide-react";

interface NextDayInstall {
  id: string;
  invoiceNumber: string | null;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  installDate: string;
  repId: string;
  jobStatus: string;
}

interface NextDayInstallsResponse {
  date: string;
  installs: NextDayInstall[];
}

export function NextDayInstallsCard() {
  const { data, isLoading } = useQuery<NextDayInstallsResponse>({
    queryKey: ["/api/dashboard/next-day-installs"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/next-day-installs", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch next-day installs");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32 mt-1" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const installs = data?.installs || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Tomorrow's Installations</CardTitle>
        </div>
        <CardDescription>
          {data?.date ? formatDate(data.date) : "Loading..."} - {installs.length} scheduled
        </CardDescription>
      </CardHeader>
      <CardContent>
        {installs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No installations scheduled for tomorrow
          </p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {installs.map((install) => (
              <div
                key={install.id}
                className="p-3 rounded-md bg-muted/50 space-y-2"
                data-testid={`card-install-${install.id}`}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium" data-testid={`text-customer-name-${install.id}`}>
                      {install.customerName}
                    </span>
                  </div>
                  {install.invoiceNumber && (
                    <span className="text-xs font-mono text-muted-foreground">
                      #{install.invoiceNumber}
                    </span>
                  )}
                </div>
                {install.customerPhone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span data-testid={`text-customer-phone-${install.id}`}>{install.customerPhone}</span>
                  </div>
                )}
                {install.customerAddress && (
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span data-testid={`text-customer-address-${install.id}`}>{install.customerAddress}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
