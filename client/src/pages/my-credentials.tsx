import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Key, User, Mail, Phone, Tablet, Shield, Eye, EyeOff, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import templateImage from "@assets/image_1767983981373.png";

interface EmployeeCredentials {
  id?: string;
  userId: string;
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

interface CredentialFormData {
  peopleSoftNumber: string;
  networkId: string;
  tempPassword: string;
  workEmail: string;
  rtr: string;
  rtrPassword: string;
  authenticatorUsername: string;
  authenticatorPassword: string;
  ipadPin: string;
  deviceNumber: string;
  gmail: string;
  gmailPassword: string;
  notes: string;
}

function PasswordField({ value, onChange, label, id }: { value: string; onChange: (v: string) => void; label: string; id: string }) {
  const [visible, setVisible] = useState(false);
  
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
          data-testid={`input-${id}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-full"
          onClick={() => setVisible(!visible)}
          data-testid={`button-toggle-${id}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export default function MyCredentials() {
  const { toast } = useToast();
  const { user } = useAuth();

  const form = useForm<CredentialFormData>({
    defaultValues: {
      peopleSoftNumber: "",
      networkId: "",
      tempPassword: "",
      workEmail: "",
      rtr: "",
      rtrPassword: "",
      authenticatorUsername: "",
      authenticatorPassword: "",
      ipadPin: "",
      deviceNumber: "",
      gmail: "",
      gmailPassword: "",
      notes: "",
    },
  });

  const { data: credentials, isLoading } = useQuery<EmployeeCredentials | null>({
    queryKey: ["/api/my-credentials"],
    queryFn: async () => {
      const res = await fetch("/api/my-credentials", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch credentials");
      return res.json();
    },
  });

  useEffect(() => {
    if (credentials) {
      form.reset({
        peopleSoftNumber: credentials.peopleSoftNumber || "",
        networkId: credentials.networkId || "",
        tempPassword: credentials.tempPassword || "",
        workEmail: credentials.workEmail || "",
        rtr: credentials.rtr || "",
        rtrPassword: credentials.rtrPassword || "",
        authenticatorUsername: credentials.authenticatorUsername || "",
        authenticatorPassword: credentials.authenticatorPassword || "",
        ipadPin: credentials.ipadPin || "",
        deviceNumber: credentials.deviceNumber || "",
        gmail: credentials.gmail || "",
        gmailPassword: credentials.gmailPassword || "",
        notes: credentials.notes || "",
      });
    }
  }, [credentials, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: CredentialFormData) => {
      return apiRequest("PATCH", "/api/my-credentials", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-credentials"] });
      toast({ title: "Credentials saved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to save credentials", variant: "destructive" });
    },
  });

  const onSubmit = (data: CredentialFormData) => {
    updateMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-amber-600" />
        <div>
          <h1 className="text-2xl font-bold text-amber-600">IRON CREST SOLUTIONS LLC</h1>
          <h2 className="text-lg font-semibold text-foreground">Access & Device Credentials Sheet</h2>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader className="bg-zinc-900 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-amber-500" />
                <span className="text-amber-500">Name</span>
                <span className="ml-4 font-normal text-white">{user?.name}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">PeopleSoft #</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="peopleSoftNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="Enter PeopleSoft number" data-testid="input-peoplesoft" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">Network ID</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="networkId"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="Enter Network ID" data-testid="input-network-id" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">Temp Password</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="tempPassword"
                      render={({ field }) => (
                        <PasswordField value={field.value} onChange={field.onChange} label="" id="tempPassword" />
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">Work Email</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="workEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} type="email" placeholder="Enter work email" data-testid="input-work-email" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">RTR</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="rtr"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="Enter RTR" data-testid="input-rtr" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">RTR Password</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="rtrPassword"
                      render={({ field }) => (
                        <PasswordField value={field.value} onChange={field.onChange} label="" id="rtrPassword" />
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">Authenticator Username</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="authenticatorUsername"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="Enter authenticator username" data-testid="input-auth-username" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">Authenticator Password</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="authenticatorPassword"
                      render={({ field }) => (
                        <PasswordField value={field.value} onChange={field.onChange} label="" id="authenticatorPassword" />
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">iPad PIN</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="ipadPin"
                      render={({ field }) => (
                        <PasswordField value={field.value} onChange={field.onChange} label="" id="ipadPin" />
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">Device #</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="deviceNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} placeholder="Enter device number" data-testid="input-device-number" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">Gmail</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="gmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input {...field} type="email" placeholder="Enter Gmail address" data-testid="input-gmail" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 divide-x">
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-800 font-medium">Gmail Password</div>
                  <div className="p-4">
                    <FormField
                      control={form.control}
                      name="gmailPassword"
                      render={({ field }) => (
                        <PasswordField value={field.value} onChange={field.onChange} label="" id="gmailPassword" />
                      )}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Additional Notes</CardTitle>
              <CardDescription>Any additional information about your devices or access credentials</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea {...field} placeholder="Enter any additional notes..." rows={3} data-testid="input-notes" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-credentials">
              <Save className="h-4 w-4 mr-2" />
              {updateMutation.isPending ? "Saving..." : "Save Credentials"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
