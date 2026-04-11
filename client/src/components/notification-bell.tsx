import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
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
  Shield,
  Settings,
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
  ORDER_SUBMITTED: "/orders",
  PAY_RUN_FINALIZED: "/my-pay",
  ADVANCE_APPROVED: "/my-pay",
  ADVANCE_REJECTED: "/my-pay",
  PAY_STUB_DELIVERY: "/my-pay",
  CHARGEBACK_ALERT: "/commissions",
  CHARGEBACK_APPLIED: "/commissions",
  DISPUTE_RESOLVED: "/my-disputes",
  PENDING_APPROVAL_ALERT: "/orders",
  LOW_PERFORMANCE_WARNING: "/dashboard",
  COMPLIANCE_EXPIRING: "/my-credentials",
};

type CategoryKey = "orders" | "pay" | "compliance" | "system";

const CATEGORY_CONFIG: Record<CategoryKey, { label: string; types: string[]; icon: typeof Bell }> = {
  orders: {
    label: "Orders",
    types: ["ORDER_APPROVED", "ORDER_REJECTED", "ORDER_SUBMITTED", "PENDING_APPROVAL_ALERT"],
    icon: CheckCircle,
  },
  pay: {
    label: "Pay",
    types: ["PAY_RUN_FINALIZED", "ADVANCE_APPROVED", "ADVANCE_REJECTED", "PAY_STUB_DELIVERY", "CHARGEBACK_ALERT", "CHARGEBACK_APPLIED", "DISPUTE_RESOLVED"],
    icon: CheckCheck,
  },
  compliance: {
    label: "Compliance",
    types: ["COMPLIANCE_EXPIRING", "LOW_PERFORMANCE_WARNING"],
    icon: Shield,
  },
  system: {
    label: "System",
    types: [],
    icon: Settings,
  },
};

const ALL_CATEGORIZED_TYPES = Object.values(CATEGORY_CONFIG).flatMap(c => c.types);

function getCategoryForType(type: string): CategoryKey {
  for (const [key, config] of Object.entries(CATEGORY_CONFIG)) {
    if (config.types.includes(type)) return key as CategoryKey;
  }
  return "system";
}

function groupByCategory(notifications: Notification[]): Record<CategoryKey, Notification[]> {
  const groups: Record<CategoryKey, Notification[]> = { orders: [], pay: [], compliance: [], system: [] };
  for (const n of notifications) {
    const cat = getCategoryForType(n.type);
    groups[cat].push(n);
  }
  return groups;
}

function relativeTime(dateStr: string): string {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
}

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
    case "COMPLIANCE_EXPIRING":
      return <Shield className="h-4 w-4 text-orange-500 shrink-0" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
};

function NotificationItem({
  notification,
  onMarkRead,
  onClick,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onClick: (n: Notification) => void;
}) {
  return (
    <button
      className={`w-full text-left px-4 py-2.5 hover:bg-accent/50 transition-colors flex gap-3 ${!notification.isRead ? "bg-accent/20" : ""}`}
      onClick={() => onClick(notification)}
      data-testid={`popover-notification-${notification.id}`}
    >
      <div className="mt-0.5">{getNotificationIcon(notification.type)}</div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${!notification.isRead ? "font-medium" : ""}`}>
          {notification.subject}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
        <p className="text-xs text-muted-foreground mt-1">{relativeTime(notification.createdAt)}</p>
      </div>
      {!notification.isRead && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 mt-0.5"
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead(notification.id);
          }}
          title="Mark as read"
          data-testid={`button-popover-mark-read-${notification.id}`}
        >
          <MailOpen className="h-3 w-3" />
        </Button>
      )}
    </button>
  );
}

function CategoryGroup({
  categoryKey,
  notifications,
  onMarkRead,
  onClick,
}: {
  categoryKey: CategoryKey;
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onClick: (n: Notification) => void;
}) {
  if (notifications.length === 0) return null;
  const config = CATEGORY_CONFIG[categoryKey];
  const Icon = config.icon;
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/50">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{config.label}</span>
        <span className="text-xs text-muted-foreground">({notifications.length})</span>
      </div>
      <div className="divide-y">
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onMarkRead={onMarkRead} onClick={onClick} />
        ))}
      </div>
    </div>
  );
}

function NotificationContent({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  isMarkAllPending,
  onClick,
  onViewAll,
}: {
  notifications: Notification[] | undefined;
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  isMarkAllPending: boolean;
  onClick: (n: Notification) => void;
  onViewAll: () => void;
}) {
  const grouped = notifications ? groupByCategory(notifications) : { orders: [], pay: [], compliance: [], system: [] };
  const hasAny = notifications && notifications.length > 0;

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h4 className="font-semibold text-sm">Notifications</h4>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onMarkAllRead}
            disabled={isMarkAllPending}
            data-testid="button-popover-mark-all-read"
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Mark all read
          </Button>
        )}
      </div>
      <ScrollArea className="max-h-80 md:max-h-96">
        {!hasAny ? (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <Bell className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground text-center">No notifications yet</p>
          </div>
        ) : (
          <div>
            {(["orders", "pay", "compliance", "system"] as CategoryKey[]).map((cat) => (
              <CategoryGroup
                key={cat}
                categoryKey={cat}
                notifications={grouped[cat]}
                onMarkRead={onMarkRead}
                onClick={onClick}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      <div className="border-t px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={onViewAll}
          data-testid="button-view-all-notifications"
        >
          View all notifications
        </Button>
      </div>
    </>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

export function NotificationBell() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const lastSeenIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const isMobile = useIsMobile();

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
    if (!recentNotifications || recentNotifications.length === 0) return;
    const newestId = recentNotifications[0]?.id;
    if (!initializedRef.current) {
      lastSeenIdRef.current = newestId || null;
      initializedRef.current = true;
      return;
    }
    if (newestId && newestId !== lastSeenIdRef.current) {
      const newItems = [];
      for (const n of recentNotifications) {
        if (n.id === lastSeenIdRef.current) break;
        if (!n.isRead && HIGH_PRIORITY_TYPES.includes(n.type)) {
          newItems.push(n);
        }
      }
      if (newItems.length > 0) {
        const newest = newItems[0];
        toast({
          title: newest.subject,
          description: newest.body.slice(0, 120),
          variant: "default",
        });
      }
      lastSeenIdRef.current = newestId;
    }
  }, [recentNotifications, toast]);

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

  const handleViewAll = () => {
    setOpen(false);
    navigate("/notifications");
  };

  const bellButton = (
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
  );

  const contentProps = {
    notifications: recentNotifications,
    unreadCount,
    onMarkRead: (id: string) => markReadMutation.mutate(id),
    onMarkAllRead: () => markAllReadMutation.mutate(),
    isMarkAllPending: markAllReadMutation.isPending,
    onClick: handleNotificationClick,
    onViewAll: handleViewAll,
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{bellButton}</SheetTrigger>
        <SheetContent side="bottom" className="h-[85vh] p-0 rounded-t-xl" data-testid="sheet-notifications">
          <SheetHeader className="sr-only">
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          <NotificationContent {...contentProps} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{bellButton}</PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" data-testid="popover-notifications">
        <NotificationContent {...contentProps} />
      </PopoverContent>
    </Popover>
  );
}
