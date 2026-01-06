import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { User } from "@shared/schema";

interface AuthContextType {
  user: User | null;
  token: string | null;
  mustChangePassword: boolean;
  login: (repId: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedMustChange = localStorage.getItem("mustChangePassword") === "true";
    if (storedToken) {
      setToken(storedToken);
      setMustChangePassword(storedMustChange);
      fetchUser(storedToken);
    } else {
      setIsLoading(false);
    }
  }, []);

  async function fetchUser(authToken: string) {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        // Update mustChangePassword from server
        if (data.user?.mustChangePassword) {
          setMustChangePassword(true);
          localStorage.setItem("mustChangePassword", "true");
        }
      } else {
        localStorage.removeItem("token");
        localStorage.removeItem("mustChangePassword");
        setToken(null);
        setMustChangePassword(false);
      }
    } catch {
      localStorage.removeItem("token");
      localStorage.removeItem("mustChangePassword");
      setToken(null);
      setMustChangePassword(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(repId: string, password: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repId, password }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Login failed");
    }
    const data = await res.json();
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem("token", data.token);
    
    // Handle mustChangePassword flag from login response
    if (data.mustChangePassword) {
      setMustChangePassword(true);
      localStorage.setItem("mustChangePassword", "true");
    } else {
      setMustChangePassword(false);
      localStorage.removeItem("mustChangePassword");
    }
  }
  
  async function refreshUser() {
    if (token) {
      await fetchUser(token);
      // Clear mustChangePassword if user no longer requires it
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.user?.mustChangePassword) {
          setMustChangePassword(false);
          localStorage.removeItem("mustChangePassword");
        }
      }
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    localStorage.removeItem("token");
    localStorage.removeItem("mustChangePassword");
  }

  return (
    <AuthContext.Provider value={{ user, token, mustChangePassword, login, logout, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
