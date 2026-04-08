import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Camera, Upload, X, Loader2, AlertTriangle, Sparkles, Plus } from "lucide-react";

const MAX_IMAGES = 4;

interface ExtractionResult {
  orderData: Record<string, string | number | null>;
  rawExtraction: Record<string, unknown>;
  confidence: Record<string, string>;
  imageObjectPath: string | null;
  imageObjectPaths: string[];
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const extractMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append("images", file);
      }

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
          description: `${result.extractedFields.length} fields extracted from ${selectedFiles.length} screenshot${selectedFiles.length > 1 ? "s" : ""}`,
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

  useEffect(() => {
    return () => {
      for (const url of previewUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [previewUrls]);

  const validateAndAddFile = (file: File): boolean => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JPEG, PNG, WebP, or GIF image",
        variant: "destructive",
      });
      return false;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 10MB per image",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !validateAndAddFile(file)) return;

    if (selectedFiles.length >= MAX_IMAGES) {
      toast({
        title: "Maximum images reached",
        description: `You can upload up to ${MAX_IMAGES} images`,
        variant: "destructive",
      });
      return;
    }

    setSelectedFiles(prev => [...prev, file]);
    setPreviewUrls(prev => [...prev, URL.createObjectURL(file)]);
    if (e.target === fileInputRef.current && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (e.target === addFileInputRef.current && addFileInputRef.current) {
      addFileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (selectedFiles.length === 0) return;
    extractMutation.mutate(selectedFiles);
  };

  const handleClearAll = () => {
    for (const url of previewUrls) {
      URL.revokeObjectURL(url);
    }
    setSelectedFiles([]);
    setPreviewUrls([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (addFileInputRef.current) addFileInputRef.current.value = "";
  };

  const triggerCamera = (inputRef: React.RefObject<HTMLInputElement | null>) => {
    inputRef.current?.click();
  };

  const triggerBrowse = (inputRef: React.RefObject<HTMLInputElement | null>) => {
    if (inputRef.current) {
      inputRef.current.removeAttribute("capture");
      inputRef.current.click();
      inputRef.current.setAttribute("capture", "environment");
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
          Upload up to {MAX_IMAGES} screenshots to auto-fill the form
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-screenshot-capture"
        />
        <input
          ref={addFileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
          data-testid="input-screenshot-capture-add"
        />

        {selectedFiles.length === 0 ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-12"
              onClick={() => triggerCamera(fileInputRef)}
              data-testid="button-upload-screenshot"
            >
              <Camera className="h-4 w-4 mr-2" />
              Take Photo
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-12"
              onClick={() => triggerBrowse(fileInputRef)}
              data-testid="button-browse-screenshot"
            >
              <Upload className="h-4 w-4 mr-2" />
              Browse Files
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {previewUrls.map((url, index) => (
                <div key={index} className="relative w-20 h-20 flex-shrink-0">
                  <img
                    src={url}
                    alt={`Screenshot ${index + 1}`}
                    className="w-full h-full object-cover rounded-md border"
                    data-testid={`img-screenshot-preview-${index}`}
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full"
                    onClick={() => handleRemoveFile(index)}
                    data-testid={`button-remove-screenshot-${index}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                  <span className="absolute bottom-0.5 left-0.5 bg-black/60 text-white text-[9px] px-1 rounded">
                    {index + 1}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{selectedFiles.length} image{selectedFiles.length > 1 ? "s" : ""} selected</span>
              <span>({(selectedFiles.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(0)} KB total)</span>
            </div>

            <div className="flex gap-2">
              {selectedFiles.length < MAX_IMAGES && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => triggerBrowse(addFileInputRef)}
                  data-testid="button-add-another-screenshot"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Another
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                data-testid="button-clear-all-screenshots"
              >
                Clear All
              </Button>
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
                  Extracting from {selectedFiles.length} image{selectedFiles.length > 1 ? "s" : ""}...
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
