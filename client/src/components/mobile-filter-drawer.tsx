import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileFilterDrawerProps {
  children: React.ReactNode;
  activeFilterCount?: number;
  className?: string;
}

export function MobileFilterDrawer({ children, activeFilterCount = 0, className }: MobileFilterDrawerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (!isMobile) {
    return <div className={cn("flex items-center gap-4 flex-wrap", className)}>{children}</div>;
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="w-full justify-between"
        data-testid="button-mobile-filters"
      >
        <span className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
              {activeFilterCount}
            </span>
          )}
        </span>
        {open ? <X className="h-4 w-4" /> : null}
      </Button>
      {open && (
        <div className="p-3 border rounded-lg bg-muted/30 space-y-3 animate-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}
