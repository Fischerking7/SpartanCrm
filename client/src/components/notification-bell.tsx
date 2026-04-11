import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  TrendingDown,
  CheckCheck,
  MailOpen,
} from "lucide-react";

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

const HIGH_PRIORITY_TYPES = ["CHARGEBACK_APPLIED", "CHARGEBACK_ALERT", "PAY_RUN_FINALIZED", "COMPLIANCE_EXPIRING", "DISPUTE_RESOLVED"];

const NOTIFICATION_NAV_MAP: Record<string, string> = {
  ORDER_APPROVED: "/order-tracker",
  ORDER_REJECTED: "/order-tracker",
  PAY_RUN_FINALIZED: "/my-pay",
  CHARGEBACK_ALERT: "/commissions",
  CHARGEBACK_APPLIED: "/commissions",
  DISPUTE_RESOLVED: "/my-disputes",
  PENDING_APPROVAL_ALERT: "/orders",
  LOW_PERFORMANCE_WARNING: "/dashboard",
};

const getNotificationIcon = (type: string) => {
  switch (type) {
    case "ORDER_APPROVED":
      return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
    case "ORDER_REJECTED":
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "PENDING_APPROVAL_ALERT":
      return <Clock className="h-4 w-4 text-orange-500 shrink-0" />;
    case "CHARGEBACK_ALERT":
    case "CHARGEBACK_APPLIED":
      return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "LOW_PERFORMANCE_WARNING":
      return <TrendingDown className="h-4 w-4 text-red-500 shrink-0" />;
    case "PAY_RUN_FINALIZED":
      return <CheckCheck className="h-4 w-4 text-blue-500 shrink-0" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
};

export function NotificationBell() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const prevCountRef = useRef<number>(-1);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: recentNotifications } = useQuery<Notification[]>({
    queryKey: ["/api/notifications", { limit: 10 }],
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=10", {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/notifications/mark-all-read"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  useEffect(() => {
    const currentCount = unreadData?.count || 0;
    if (prevCountRef.current === -1) {
      prevCountRef.current = currentCount;
      return;
    }
    if (currentCount > prevCountRef.current && recentNotifications && recentNotifications.length > 0) {
      const newest = recentNotifications.find(n => !n.isRead && HIGH_PRIORITY_TYPES.includes(n.type));
      if (newest) {
        toast({
          title: newest.subject,
          description: newest.body.slice(0, 120),
          variant: "default",
        });
      }
    }
    prevCountRef.current = currentCount;
  }, [unreadData?.count, recentNotifications, toast]);

  const unreadCount = unreadData?.count || 0;

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markReadMutation.mutate(notification.id);
    }
    const navTarget = NOTIFICATION_NAV_MAP[notification.type];
    if (navTarget) {
      setOpen(false);
      navigate(navTarget);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-notification-bell"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
              data-testid="badge-bell-unread"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" data-testid="popover-notifications">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">Notifications</h4>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                data-testid="button-popover-mark-all-read"
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-80">
          {!recentNotifications || recentNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4">
              <Bell className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground text-center">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {recentNotifications.map((n) => (
                <button
                  key={n.id}
                  className={`w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors flex gap-3 ${!n.isRead ? "bg-accent/20" : ""}`}
                  onClick={() => handleNotificationClick(n)}
                  data-testid={`popover-notification-${n.id}`}
                >
                  <div className="mt-0.5">{getNotificationIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${!n.isRead ? "font-medium" : ""}`}>
                      {n.subject}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(n.createdAt), "MMM d 'at' h:mm a")}
                    </p>
                  </div>
                  {!n.isRead && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 mt-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        markReadMutation.mutate(n.id);
                      }}
                      title="Mark as read"
                      data-testid={`button-popover-mark-read-${n.id}`}
                    >
                      <MailOpen className="h-3 w-3" />
                    </Button>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => { setOpen(false); navigate("/notifications"); }}
            data-testid="button-view-all-notifications"
          >
            View all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
