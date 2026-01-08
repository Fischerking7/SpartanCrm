import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import type { KnowledgeDocument } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { UploadResult } from "@uppy/core";
import {
  FileText,
  FileImage,
  File,
  Upload,
  Download,
  Trash2,
  Edit,
  Search,
  FolderOpen,
  X,
  ExternalLink,
} from "lucide-react";

const CATEGORIES = [
  "Training",
  "Policies",
  "Procedures",
  "Product Info",
  "Sales Materials",
  "Templates",
  "Other",
];

function getFileTypeFromMime(mimeType: string): "PDF" | "WORD" | "IMAGE" | "OTHER" {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("word") || mimeType.includes("document")) return "WORD";
  if (mimeType.startsWith("image/")) return "IMAGE";
  return "OTHER";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileType: string) {
  switch (fileType) {
    case "PDF":
      return <FileText className="h-8 w-8 text-red-500" />;
    case "WORD":
      return <FileText className="h-8 w-8 text-blue-500" />;
    case "IMAGE":
      return <FileImage className="h-8 w-8 text-green-500" />;
    default:
      return <File className="h-8 w-8 text-gray-500" />;
  }
}

export default function KnowledgeDatabase() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ objectPath: string; metadata: { name: string; size: number; contentType: string } } | null>(null);
  
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocDescription, setNewDocDescription] = useState("");
  const [newDocCategory, setNewDocCategory] = useState("");
  
  // Store the objectPath from the upload URL request
  const pendingObjectPathRef = useRef<string | null>(null);

  const isAdmin = user?.role === "ADMIN" || user?.role === "FOUNDER";
  const canDelete = isAdmin || user?.role === "MANAGER" || user?.role === "EXECUTIVE";
  const canUpload = user?.role !== "REP" && user?.role !== "SUPERVISOR";

  const { data: documents = [], isLoading } = useQuery<KnowledgeDocument[]>({
    queryKey: ["/api/knowledge-documents"],
    queryFn: async () => {
      const res = await fetch("/api/knowledge-documents", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description: string;
      fileName: string;
      fileType: "PDF" | "WORD" | "IMAGE" | "OTHER";
      fileSize: number;
      mimeType: string;
      objectPath: string;
      category: string;
    }) => {
      const res = await apiRequest("POST", "/api/knowledge-documents", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge-documents"] });
      toast({ title: "Document uploaded successfully" });
      resetUploadForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save document", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; title?: string; description?: string; category?: string }) => {
      const res = await apiRequest("PATCH", `/api/knowledge-documents/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge-documents"] });
      toast({ title: "Document updated" });
      setShowEditDialog(false);
      setSelectedDocument(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update document", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/knowledge-documents/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge-documents"] });
      toast({ title: "Document deleted" });
      setShowDeleteDialog(false);
      setSelectedDocument(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete document", description: error.message, variant: "destructive" });
    },
  });

  const resetUploadForm = () => {
    setShowUploadDialog(false);
    setUploadedFile(null);
    setNewDocTitle("");
    setNewDocDescription("");
    setNewDocCategory("");
  };

  const handleUploadComplete = (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (result.successful && result.successful.length > 0) {
      const uploaded = result.successful[0];
      const fileName = uploaded.name || "document";
      const fileSize = uploaded.size || 0;
      const contentType = uploaded.type || "application/octet-stream";
      // Use the objectPath stored during the request-url call
      const objectPath = pendingObjectPathRef.current || `uploads/${fileName}`;
      
      setUploadedFile({
        objectPath,
        metadata: { name: fileName, size: fileSize, contentType },
      });
      setNewDocTitle(fileName.replace(/\.[^/.]+$/, ""));
      pendingObjectPathRef.current = null;
    }
  };

  const handleSaveDocument = () => {
    if (!uploadedFile || !newDocTitle) {
      toast({ title: "Please upload a file and provide a title", variant: "destructive" });
      return;
    }

    createMutation.mutate({
      title: newDocTitle,
      description: newDocDescription,
      fileName: uploadedFile.metadata.name,
      fileType: getFileTypeFromMime(uploadedFile.metadata.contentType),
      fileSize: uploadedFile.metadata.size,
      mimeType: uploadedFile.metadata.contentType,
      objectPath: uploadedFile.objectPath,
      category: newDocCategory || "Other",
    });
  };

  const handleEditDocument = (doc: KnowledgeDocument) => {
    setSelectedDocument(doc);
    setNewDocTitle(doc.title);
    setNewDocDescription(doc.description || "");
    setNewDocCategory(doc.category || "");
    setShowEditDialog(true);
  };

  const handleUpdateDocument = () => {
    if (!selectedDocument) return;
    updateMutation.mutate({
      id: selectedDocument.id,
      title: newDocTitle,
      description: newDocDescription,
      category: newDocCategory,
    });
  };

  const handleDeleteDocument = (doc: KnowledgeDocument) => {
    setSelectedDocument(doc);
    setShowDeleteDialog(true);
  };

  const handleViewDocument = (doc: KnowledgeDocument) => {
    setSelectedDocument(doc);
    setShowViewDialog(true);
  };
  
  const getDocumentUrl = (doc: KnowledgeDocument) => {
    // Serve files through the local object storage route
    // objectPath should already start with /objects/ from the upload
    if (doc.objectPath.startsWith("/objects/")) {
      return doc.objectPath;
    }
    return `/objects/${doc.objectPath}`;
  };

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      searchTerm === "" ||
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (doc.description && doc.description.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesCategory = categoryFilter === "all" || doc.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge Database</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Reference documents, training materials, and resources
          </p>
        </div>
        {canUpload && (
          <Button onClick={() => setShowUploadDialog(true)} data-testid="button-upload-document">
            <Upload className="h-4 w-4 mr-2" />
            Upload Document
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search-documents"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-48" data-testid="select-category-filter">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredDocuments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No documents found</h3>
            <p className="text-muted-foreground text-sm">
              {documents.length === 0
                ? "Upload your first document to get started"
                : "Try adjusting your search or filter"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocuments.map((doc) => (
            <Card key={doc.id} className="hover-elevate cursor-pointer" data-testid={`card-document-${doc.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 p-2 bg-muted rounded-md">
                    {getFileIcon(doc.fileType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate" title={doc.title}>
                      {doc.title}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {doc.fileName}
                    </p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {doc.fileType}
                      </Badge>
                      {doc.category && (
                        <Badge variant="secondary" className="text-xs">
                          {doc.category}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(doc.fileSize)}
                      </span>
                    </div>
                    {doc.description && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                        {doc.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 mt-4 pt-4 border-t">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleViewDocument(doc)}
                    title="View Document"
                    data-testid={`button-view-${doc.id}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleEditDocument(doc)}
                    title="Edit Details"
                    data-testid={`button-edit-${doc.id}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  {canDelete && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDeleteDocument(doc)}
                      title="Delete Document"
                      data-testid={`button-delete-${doc.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              Upload a PDF, Word document, or image to the knowledge database
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!uploadedFile ? (
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <ObjectUploader
                  onGetUploadParameters={async (file) => {
                    const res = await fetch("/api/uploads/request-url", {
                      method: "POST",
                      headers: { 
                        "Content-Type": "application/json",
                        ...getAuthHeaders()
                      },
                      body: JSON.stringify({
                        name: file.name,
                        size: file.size,
                        contentType: file.type || "application/octet-stream",
                      }),
                    });
                    if (!res.ok) throw new Error("Failed to get upload URL");
                    const data = await res.json();
                    // Store the objectPath for use in handleUploadComplete
                    pendingObjectPathRef.current = data.objectPath;
                    return {
                      method: "PUT" as const,
                      url: data.uploadURL,
                      headers: { "Content-Type": file.type || "application/octet-stream" },
                    };
                  }}
                  onComplete={handleUploadComplete}
                >
                  <Button variant="outline" data-testid="button-select-file">
                    <Upload className="h-4 w-4 mr-2" />
                    Select File
                  </Button>
                </ObjectUploader>
                <p className="text-xs text-muted-foreground mt-2">
                  Supported: PDF, Word docs, Images
                </p>
              </div>
            ) : (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  {getFileIcon(getFileTypeFromMime(uploadedFile.metadata.contentType))}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{uploadedFile.metadata.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(uploadedFile.metadata.size)}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setUploadedFile(null)}
                    data-testid="button-remove-file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Title</label>
                <Input
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  placeholder="Document title"
                  data-testid="input-doc-title"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Category</label>
                <Select value={newDocCategory} onValueChange={setNewDocCategory}>
                  <SelectTrigger data-testid="select-doc-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
                <Textarea
                  value={newDocDescription}
                  onChange={(e) => setNewDocDescription(e.target.value)}
                  placeholder="Brief description of the document"
                  rows={3}
                  data-testid="input-doc-description"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetUploadForm} data-testid="button-cancel-upload">
              Cancel
            </Button>
            <Button
              onClick={handleSaveDocument}
              disabled={!uploadedFile || !newDocTitle || createMutation.isPending}
              data-testid="button-save-document"
            >
              {createMutation.isPending ? "Saving..." : "Save Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
            <DialogDescription>
              Update the document details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Title</label>
              <Input
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                placeholder="Document title"
                data-testid="input-edit-title"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category</label>
              <Select value={newDocCategory} onValueChange={setNewDocCategory}>
                <SelectTrigger data-testid="select-edit-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
              <Textarea
                value={newDocDescription}
                onChange={(e) => setNewDocDescription(e.target.value)}
                placeholder="Brief description"
                rows={3}
                data-testid="input-edit-description"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button
              onClick={handleUpdateDocument}
              disabled={!newDocTitle || updateMutation.isPending}
              data-testid="button-update-document"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedDocument?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedDocument && deleteMutation.mutate(selectedDocument.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedDocument && getFileIcon(selectedDocument.fileType)}
              <span className="truncate">{selectedDocument?.title}</span>
            </DialogTitle>
            {selectedDocument?.description && (
              <DialogDescription>{selectedDocument.description}</DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{selectedDocument?.category}</Badge>
              <span>{selectedDocument && formatFileSize(selectedDocument.fileSize)}</span>
              <span>{selectedDocument?.fileName}</span>
            </div>
            
            {selectedDocument?.fileType === "IMAGE" ? (
              <div className="border rounded-lg overflow-hidden">
                <img 
                  src={selectedDocument && getDocumentUrl(selectedDocument)} 
                  alt={selectedDocument?.title}
                  className="w-full h-auto max-h-[50vh] object-contain"
                />
              </div>
            ) : selectedDocument?.mimeType === "application/pdf" ? (
              <div className="border rounded-lg overflow-hidden h-[50vh]">
                <iframe
                  src={selectedDocument && getDocumentUrl(selectedDocument)}
                  className="w-full h-full"
                  title={selectedDocument?.title}
                />
              </div>
            ) : (
              <div className="border rounded-lg p-8 text-center">
                <div className="mb-4">
                  {selectedDocument && getFileIcon(selectedDocument.fileType)}
                </div>
                <p className="text-muted-foreground mb-4">
                  This file type cannot be previewed in the browser.
                </p>
                <Button asChild data-testid="button-download-document">
                  <a 
                    href={selectedDocument ? getDocumentUrl(selectedDocument) : undefined} 
                    download={selectedDocument?.fileName}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download File
                  </a>
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowViewDialog(false)} data-testid="button-close-view">
              Close
            </Button>
            <Button asChild data-testid="button-download-from-view">
              <a 
                href={selectedDocument ? getDocumentUrl(selectedDocument) : undefined} 
                download={selectedDocument?.fileName}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
