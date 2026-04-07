import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, X, Loader2, AlertTriangle, Sparkles, CheckCircle2 } from "lucide-react";

interface ExtractionResult {
  orderData: Record<string, string | number | null>;
  rawExtraction: Record<string, unknown>;
  confidence: Record<string, string>;
  imageObjectPath: string | null;
  missingRequired: string[];
  extractedFields: string[];
  warning: string | null;
}

interface ScreenshotCaptureProps {
  onExtracted: (result: ExtractionResult) => void;
  onClose?: () => void;
}

export function ScreenshotCapture({ onExtracted, onClose }: ScreenshotCaptureProps) {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const extractMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);

      const authHeaders = getAuthHeaders() as { Authorization: string };
      const res = await fetch("/api/orders/capture", {
        method: "POST",
        headers: { Authorization: authHeaders.Authorization },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to extract data from screenshot");
      }
      return data as ExtractionResult;
    },
    onSuccess: (result) => {
      if (result.warning) {
        toast({
          title: "Partial extraction",
          description: result.warning,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Data extracted successfully",
          description: `${result.extractedFields.length} fields extracted from screenshot`,
        });
      }
      onExtracted(result);
    },
    onError: (error: Error) => {
      toast({
        title: "Extraction failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JPEG, PNG, WebP, or GIF image",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 10MB",
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleSubmit = () => {
    if (!selectedFile) return;
    extractMutation.mutate(selectedFile);
  };

  const handleClear = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">AI Screenshot Capture</span>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} data-testid="button-close-capture">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Upload or photograph an order confirmation screen to auto-fill the form
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
          id="screenshot-capture-input"
          data-testid="input-screenshot-capture"
        />

        {!selectedFile ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-12"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-upload-screenshot"
            >
              <Camera className="h-4 w-4 mr-2" />
              Take Photo
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-12"
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.removeAttribute("capture");
                  fileInputRef.current.click();
                  fileInputRef.current.setAttribute("capture", "environment");
                }
              }}
              data-testid="button-browse-screenshot"
            >
              <Upload className="h-4 w-4 mr-2" />
              Browse Files
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {previewUrl && (
              <div className="relative">
                <img
                  src={previewUrl}
                  alt="Screenshot preview"
                  className="w-full max-h-48 object-contain rounded-md border"
                  data-testid="img-screenshot-preview"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6"
                  onClick={handleClear}
                  data-testid="button-clear-screenshot"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{selectedFile.name}</span>
              <span>({(selectedFile.size / 1024).toFixed(0)} KB)</span>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={handleSubmit}
              disabled={extractMutation.isPending}
              data-testid="button-extract-screenshot"
            >
              {extractMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Extracting with AI...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Extract Order Data
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface AiFieldIndicatorProps {
  fieldName: string;
  confidence?: string;
}

export function AiFieldIndicator({ fieldName, confidence }: AiFieldIndicatorProps) {
  const color = confidence === "high" ? "text-green-600" : confidence === "medium" ? "text-yellow-600" : "text-orange-600";
  return (
    <Badge variant="outline" className={`text-[10px] px-1 py-0 ${color} border-current`} data-testid={`badge-ai-extracted-${fieldName}`}>
      <Sparkles className="h-2.5 w-2.5 mr-0.5" />
      AI
    </Badge>
  );
}

export function MissingFieldsWarning({ missingFields }: { missingFields: string[] }) {
  if (missingFields.length <= 2) return null;
  return (
    <Card className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Some fields could not be extracted
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
              Missing: {missingFields.join(", ")}. Please complete these fields manually.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
