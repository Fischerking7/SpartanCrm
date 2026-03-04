import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth, getAuthHeaders } from "@/lib/auth";

export function useActivityTracker() {
  const [location] = useLocation();
  const { user } = useAuth();
  const lastPage = useRef<string>("");

  useEffect(() => {
    if (!user || location === lastPage.current) return;
    lastPage.current = location;

    fetch("/api/activity", {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ page: location }),
    }).catch(() => {});
  }, [location, user]);
}
