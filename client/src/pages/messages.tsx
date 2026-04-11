import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, Inbox, CheckCheck, Clock, Plus, ArrowLeft, Mail, MailOpen } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Message {
  id: string;
  fromUserId: string;
  toUserId: string;
  parentMessageId: string | null;
  category: string;
  subject: string;
  body: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  fromUserName: string;
  fromUserRole?: string;
  toUserName: string;
  toUserRole?: string;
  fromRepId?: string;
}

const categoryLabels: Record<string, string> = {
  COMMISSION_INQUIRY: "Commission",
  PAY_QUESTION: "Pay",
  GENERAL: "General",
  SCHEDULE: "Schedule",
  COMPLIANCE: "Compliance",
};

const categoryColors: Record<string, string> = {
  COMMISSION_INQUIRY: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  PAY_QUESTION: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  GENERAL: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  SCHEDULE: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  COMPLIANCE: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

function ComposeDialog({ open, onOpenChange, defaultCategory, defaultSubject, defaultBody, defaultToUserId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCategory?: string;
  defaultSubject?: string;
  defaultBody?: string;
  defaultToUserId?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [toUserId, setToUserId] = useState(defaultToUserId || "");
  const [subject, setSubject] = useState(defaultSubject || "");
  const [body, setBody] = useState(defaultBody || "");
  const [category, setCategory] = useState(defaultCategory || "GENERAL");

  const { data: supervisors } = useQuery<Array<{ id: string; name: string; role: string }>>({
    queryKey: ["/api/messages/recipients"],
    queryFn: async () => {
      const res = await fetch("/api/messages/recipients", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId, subject, body, category }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Message sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
      onOpenChange(false);
      setToUserId("");
      setSubject("");
      setBody("");
      setCategory("GENERAL");
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const supervisorId = user?.assignedSupervisorId;
  const managerId = user?.assignedManagerId;

  const quickRecipients = (supervisors || []).filter(
    (u: { id: string }) => u.id === supervisorId || u.id === managerId
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">To</label>
            {quickRecipients.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-2">
                {quickRecipients.map((r: { id: string; name: string; role: string }) => (
                  <Button
                    key={r.id}
                    variant={toUserId === r.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setToUserId(r.id)}
                    data-testid={`btn-recipient-${r.id}`}
                  >
                    {r.name} ({r.role})
                  </Button>
                ))}
              </div>
            ) : null}
            <Select value={toUserId} onValueChange={setToUserId}>
              <SelectTrigger data-testid="select-recipient">
                <SelectValue placeholder="Select recipient" />
              </SelectTrigger>
              <SelectContent>
                {(supervisors || []).map((u: { id: string; name: string; role: string }) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} ({u.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(categoryLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Subject</label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" data-testid="input-subject" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Message</label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Type your message..." rows={4} data-testid="input-body" />
          </div>
          <Button
            className="w-full"
            onClick={() => sendMutation.mutate()}
            disabled={!toUserId || !subject || !body || sendMutation.isPending}
            data-testid="btn-send-message"
          >
            <Send className="h-4 w-4 mr-2" />
            {sendMutation.isPending ? "Sending..." : "Send Message"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReplyDialog({ open, onOpenChange, parentMessage }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentMessage: Message;
}) {
  const { toast } = useToast();
  const [body, setBody] = useState("");

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId: parentMessage.fromUserId,
          subject: `Re: ${parentMessage.subject}`,
          body,
          category: parentMessage.category,
          parentMessageId: parentMessage.parentMessageId || parentMessage.id,
        }),
      });
      if (!res.ok) throw new Error("Failed to send reply");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reply sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/team-inbox"] });
      onOpenChange(false);
      setBody("");
    },
    onError: () => {
      toast({ title: "Failed to send reply", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reply to {parentMessage.fromUserName}</DialogTitle>
        </DialogHeader>
        <div className="rounded-md bg-muted/50 p-3 text-sm mb-4">
          <p className="font-medium">{parentMessage.subject}</p>
          <p className="text-muted-foreground mt-1">{parentMessage.body}</p>
        </div>
        <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Type your reply..." rows={4} data-testid="input-reply-body" />
        <Button
          className="w-full mt-2"
          onClick={() => replyMutation.mutate()}
          disabled={!body || replyMutation.isPending}
          data-testid="btn-send-reply"
        >
          <Send className="h-4 w-4 mr-2" />
          {replyMutation.isPending ? "Sending..." : "Send Reply"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function MessageCard({ message, isIncoming, onReply, onMarkRead }: {
  message: Message;
  isIncoming: boolean;
  onReply: () => void;
  onMarkRead: () => void;
}) {
  const isMobile = useIsMobile();

  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-muted/30 ${isIncoming && !message.isRead ? "border-l-4 border-l-[hsl(var(--sidebar-primary))]" : ""}`}
      onClick={() => {
        if (isIncoming && !message.isRead) onMarkRead();
      }}
      data-testid={`message-card-${message.id}`}
    >
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isIncoming && !message.isRead && (
                <Mail className="h-4 w-4 text-[hsl(var(--sidebar-primary))] flex-shrink-0" />
              )}
              {isIncoming && message.isRead && (
                <MailOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className="font-medium text-sm truncate">
                {isIncoming ? message.fromUserName : `To: ${message.toUserName}`}
              </span>
              <Badge variant="outline" className={`text-[10px] ${categoryColors[message.category] || ""}`}>
                {categoryLabels[message.category] || message.category}
              </Badge>
            </div>
            <p className="font-medium text-sm mt-1 truncate">{message.subject}</p>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{message.body}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
            </span>
            {isIncoming && (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onReply(); }} data-testid={`btn-reply-${message.id}`}>
                <ArrowLeft className="h-3 w-3 mr-1" />
                Reply
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [activeTab, setActiveTab] = useState("inbox");
  const isManager = ["LEAD", "MANAGER", "DIRECTOR", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(user?.role || "");

  const { data: messages, isLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages"],
    queryFn: async () => {
      const res = await fetch("/api/messages", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: teamMessages } = useQuery<Message[]>({
    queryKey: ["/api/messages/team-inbox"],
    queryFn: async () => {
      const res = await fetch("/api/messages/team-inbox", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isManager,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/messages/${id}/read`, { method: "PATCH", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/unread-count"] });
    },
  });

  const inboxMessages = (messages || []).filter(m => m.toUserId === user?.id);
  const sentMessages = (messages || []).filter(m => m.fromUserId === user?.id);
  const unreadCount = inboxMessages.filter(m => !m.isRead).length;
  const teamUnreadCount = (teamMessages || []).filter(m => !m.isRead).length;

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg md:text-2xl font-bold" data-testid="text-messages-title">Messages</h1>
          <p className="text-sm text-muted-foreground">Communicate with your team</p>
        </div>
        <Button onClick={() => setComposeOpen(true)} data-testid="btn-compose">
          <Plus className="h-4 w-4 mr-2" />
          {isMobile ? "New" : "New Message"}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox" data-testid="tab-inbox">
            <Inbox className="h-4 w-4 mr-1" />
            Inbox
            {unreadCount > 0 && (
              <Badge className="ml-1 h-5 min-w-[20px] bg-red-500 text-white text-[10px]">{unreadCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="sent" data-testid="tab-sent">
            <Send className="h-4 w-4 mr-1" />
            Sent
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="team" data-testid="tab-team">
              <MessageSquare className="h-4 w-4 mr-1" />
              Team
              {teamUnreadCount > 0 && (
                <Badge className="ml-1 h-5 min-w-[20px] bg-red-500 text-white text-[10px]">{teamUnreadCount}</Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="inbox" className="space-y-2 mt-4">
          {inboxMessages.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Inbox className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No messages yet</p>
                <p className="text-sm mt-1">Messages from your team will appear here</p>
              </CardContent>
            </Card>
          ) : (
            inboxMessages.map(m => (
              <MessageCard
                key={m.id}
                message={m}
                isIncoming={true}
                onReply={() => setReplyingTo(m)}
                onMarkRead={() => markReadMutation.mutate(m.id)}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="sent" className="space-y-2 mt-4">
          {sentMessages.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Send className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No sent messages</p>
                <p className="text-sm mt-1">Messages you send will appear here</p>
              </CardContent>
            </Card>
          ) : (
            sentMessages.map(m => (
              <MessageCard
                key={m.id}
                message={m}
                isIncoming={false}
                onReply={() => {}}
                onMarkRead={() => {}}
              />
            ))
          )}
        </TabsContent>

        {isManager && (
          <TabsContent value="team" className="space-y-2 mt-4">
            {(teamMessages || []).length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No team messages</p>
                  <p className="text-sm mt-1">Messages from your direct reports will appear here</p>
                </CardContent>
              </Card>
            ) : (
              (teamMessages || []).map(m => (
                <MessageCard
                  key={m.id}
                  message={m}
                  isIncoming={true}
                  onReply={() => setReplyingTo(m)}
                  onMarkRead={() => markReadMutation.mutate(m.id)}
                />
              ))
            )}
          </TabsContent>
        )}
      </Tabs>

      <ComposeDialog open={composeOpen} onOpenChange={setComposeOpen} />
      {replyingTo && (
        <ReplyDialog open={!!replyingTo} onOpenChange={(open) => { if (!open) setReplyingTo(null); }} parentMessage={replyingTo} />
      )}
    </div>
  );
}

export { ComposeDialog };
