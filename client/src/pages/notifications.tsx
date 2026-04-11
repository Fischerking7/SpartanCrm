import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";
import {
  Bell,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  TrendingDown,
  CheckCheck,
  Mail,
  MailOpen,
  Shield,
} from "lucide-react";
import {
  NOTIFICATION_NAV_MAP,
  filterByCategory,
  type CategoryKeyWithAll,
} from "@/lib/notification-types";

type Notification = {
  id: string;
  userId: string;
  type: string;
  subject: string;
  body: string;
  status: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  sentAt: string | null;
};

const getNotificationIcon = (type: string) => {
  switch (type) {
    case "ORDER_APPROVED":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "ORDER_REJECTED":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "PENDING_APPROVAL_ALERT":
      return <Clock className="h-5 w-5 text-orange-500" />;
    case "CHARGEBACK_ALERT":
    case "CHARGEBACK_APPLIED":
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case "LOW_PERFORMANCE_WARNING":
      return <TrendingDown className="h-5 w-5 text-red-500" />;
    case "PAY_RUN_FINALIZED":
      return <CheckCheck className="h-5 w-5 text-blue-500" />;
    case "COMPLIANCE_EXPIRING":
      return <Shield className="h-5 w-5 text-orange-500" />;
    default:
      return <Bell className="h-5 w-5 text-muted-foreground" />;
  }
};

const getNotificationBadge = (type: string) => {
  switch (type) {
    case "ORDER_APPROVED":
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">Approved</Badge>;
    case "ORDER_REJECTED":
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">Rejected</Badge>;
    case "PENDING_APPROVAL_ALERT":
      return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">Pending</Badge>;
    case "CHARGEBACK_ALERT":
    case "CHARGEBACK_APPLIED":
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800">Chargeback</Badge>;
    case "LOW_PERFORMANCE_WARNING":
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">Performance</Badge>;
    case "PAY_RUN_FINALIZED":
      return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">Payroll</Badge>;
    case "DISPUTE_RESOLVED":
      return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800">Dispute</Badge>;
    case "COMPLIANCE_EXPIRING":
      return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800">Compliance</Badge>;
    default:
      return <Badge variant="outline">Info</Badge>;
  }
};

export default function NotificationsPage() {
  const [, navigate] = useLocation();
  const [category, setCategory] = useState<CategoryKeyWithAll>("all");

  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-3 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="h-10 w-full" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const unreadCount = unreadData?.count || 0;
  const filteredNotifications = notifications ? filterByCategory(notifications, category) : [];
  const filteredUnread = filteredNotifications.filter(n => !n.isRead).length;

  const getCategoryCount = (cat: CategoryKeyWithAll) => {
    if (!notifications) return 0;
    return filterByCategory(notifications, cat).length;
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markReadMutation.mutate(notification.id);
    }
    const navTarget = NOTIFICATION_NAV_MAP[notification.type];
    if (navTarget) {
      navigate(navTarget);
    }
  };

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 md:h-6 md:w-6" />
          <h1 className="text-xl md:text-2xl font-semibold">Notifications</h1>
          {unreadCount > 0 && (
            <Badge variant="default" data-testid="badge-unread-count">{unreadCount} unread</Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark All Read
          </Button>
        )}
      </div>

      <Tabs value={category} onValueChange={(v) => setCategory(v as CategoryKeyWithAll)}>
        <TabsList className="w-full justify-start overflow-x-auto" data-testid="tabs-notification-category">
          <TabsTrigger value="all" data-testid="tab-all">
            All ({notifications?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-orders">
            Orders ({getCategoryCount("orders")})
          </TabsTrigger>
          <TabsTrigger value="pay" data-testid="tab-pay">
            Pay ({getCategoryCount("pay")})
          </TabsTrigger>
          <TabsTrigger value="compliance" data-testid="tab-compliance">
            Compliance ({getCategoryCount("compliance")})
          </TabsTrigger>
          <TabsTrigger value="system" data-testid="tab-system">
            System ({getCategoryCount("system")})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {filteredUnread > 0 && category !== "all" && (
        <div className="text-sm text-muted-foreground">
          {filteredUnread} unread in this category
        </div>
      )}

      {filteredNotifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              {category === "all"
                ? "No notifications yet. You'll receive alerts here for order updates, chargebacks, and more."
                : `No ${category} notifications.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2 md:space-y-3">
          {filteredNotifications.map((notification) => (
            <Card
              key={notification.id}
              className={`transition-colors cursor-pointer hover:bg-accent/10 ${!notification.isRead ? "bg-accent/30 border-primary/20" : ""}`}
              onClick={() => handleNotificationClick(notification)}
              data-testid={`card-notification-${notification.id}`}
            >
              <CardContent className="p-3 md:p-4">
                <div className="flex items-start gap-3 md:gap-4">
                  <div className="flex-shrink-0 mt-1">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {getNotificationBadge(notification.type)}
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                      </span>
                      <span className="text-xs text-muted-foreground hidden md:inline">
                        ({format(new Date(notification.createdAt), "MMM d, yyyy 'at' h:mm a")})
                      </span>
                      {!notification.isRead && (
                        <Badge variant="secondary" className="text-xs">New</Badge>
                      )}
                    </div>
                    <h3 className="font-medium text-sm md:text-base mb-1">{notification.subject}</h3>
                    <p className="text-xs md:text-sm text-muted-foreground whitespace-pre-wrap">
                      {notification.body}
                    </p>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {notification.status === "SENT" ? (
                      <span title="Email sent"><Mail className="h-4 w-4 text-green-500" /></span>
                    ) : notification.status === "PENDING" ? (
                      <span title="Email pending"><Clock className="h-4 w-4 text-muted-foreground" /></span>
                    ) : null}
                    {!notification.isRead && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          markReadMutation.mutate(notification.id);
                        }}
                        disabled={markReadMutation.isPending}
                        title="Mark as read"
                        data-testid={`button-mark-read-${notification.id}`}
                      >
                        <MailOpen className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
