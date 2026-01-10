import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Key, CreditCard, Eye, EyeOff, User, Shield } from "lucide-react";
import { useState } from "react";

interface EmployeeCredential {
  id: string;
  userId: string;
  entryLabel: string;
  peopleSoftNumber: string | null;
  networkId: string | null;
  tempPassword: string | null;
  workEmail: string | null;
  rtr: string | null;
  rtrPassword: string | null;
  authenticatorUsername: string | null;
  authenticatorPassword: string | null;
  ipadPin: string | null;
  deviceNumber: string | null;
  gmail: string | null;
  gmailPassword: string | null;
  notes: string | null;
}

interface BankAccount {
  id: string;
  userId: string;
  accountHolderName: string;
  bankName: string;
  accountType: string;
  routingNumber: string;
  accountNumber: string;
  isPrimary: boolean;
}

function PasswordDisplay({ value, label }: { value: string | null; label: string }) {
  const [visible, setVisible] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{visible ? value : "••••••••"}</span>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

function FieldDisplay({ value, label }: { value: string | null | undefined; label: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

function CredentialCard({ credential }: { credential: EmployeeCredential }) {
  const [showPasswords, setShowPasswords] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Key className="h-4 w-4" />
            {credential.entryLabel || "Default"}
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowPasswords(!showPasswords)}
            data-testid={`button-toggle-passwords-${credential.id}`}
          >
            {showPasswords ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {showPasswords ? "Hide" : "Show"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <FieldDisplay value={credential.peopleSoftNumber} label="PeopleSoft #" />
        <FieldDisplay value={credential.networkId} label="Network ID" />
        <FieldDisplay value={credential.workEmail} label="Work Email" />
        <FieldDisplay value={credential.deviceNumber} label="Device #" />
        <FieldDisplay value={credential.rtr} label="RTR" />
        <FieldDisplay value={credential.authenticatorUsername} label="Authenticator Username" />
        <FieldDisplay value={credential.gmail} label="Gmail" />
        
        {showPasswords && (
          <>
            <PasswordDisplay value={credential.tempPassword} label="Temp Password" />
            <PasswordDisplay value={credential.rtrPassword} label="RTR Password" />
            <PasswordDisplay value={credential.authenticatorPassword} label="Authenticator Password" />
            <PasswordDisplay value={credential.ipadPin} label="iPad PIN" />
            <PasswordDisplay value={credential.gmailPassword} label="Gmail Password" />
          </>
        )}
        
        {credential.notes && (
          <div className="pt-3 mt-2 border-t">
            <span className="text-muted-foreground text-sm">Notes:</span>
            <p className="text-sm mt-1 whitespace-pre-wrap">{credential.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BankAccountCard({ account }: { account: BankAccount }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            {account.bankName}
          </CardTitle>
          {account.isPrimary && <Badge variant="default">Primary</Badge>}
        </div>
        <CardDescription className="capitalize">{account.accountType} Account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <FieldDisplay value={account.accountHolderName} label="Account Holder" />
        <FieldDisplay value={account.routingNumber} label="Routing #" />
        <FieldDisplay value={account.accountNumber} label="Account #" />
      </CardContent>
    </Card>
  );
}

export default function MyCredentials() {
  const { user } = useAuth();

  const { data: credentials, isLoading: loadingCredentials } = useQuery<EmployeeCredential[]>({
    queryKey: ["/api/profile/credentials"],
    queryFn: async () => {
      const res = await fetch("/api/profile/credentials", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: bankAccounts, isLoading: loadingBankAccounts } = useQuery<BankAccount[]>({
    queryKey: ["/api/profile/bank-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/profile/bank-accounts", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <User className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">My Profile</h1>
          <p className="text-muted-foreground">View your credentials and banking information</p>
        </div>
      </div>

      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-medium">{user?.name}</p>
              <p className="text-sm text-muted-foreground">Rep ID: {user?.repId} • Role: {user?.role}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="credentials" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="credentials" className="gap-2">
            <Key className="h-4 w-4" />
            Credentials
          </TabsTrigger>
          <TabsTrigger value="banking" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Banking
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="credentials" className="mt-6">
          {loadingCredentials ? (
            <div className="space-y-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : !credentials?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No credentials on file</p>
                <p className="text-sm text-muted-foreground mt-1">Contact your admin to set up your credentials.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {credentials.map((credential) => (
                <CredentialCard key={credential.id} credential={credential} />
              ))}
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="banking" className="mt-6">
          {loadingBankAccounts ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : !bankAccounts?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No bank accounts on file</p>
                <p className="text-sm text-muted-foreground mt-1">Contact your admin to set up your banking information.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {bankAccounts.map((account) => (
                <BankAccountCard key={account.id} account={account} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
