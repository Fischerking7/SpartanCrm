import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Language = "en" | "es";

interface LanguageContextType {
  language: Language;
  toggleLanguage: () => void;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem("language") as Language;
    if (stored === "en" || stored === "es") return stored;
    return "en";
  });

  useEffect(() => {
    i18n.changeLanguage(language);
    document.documentElement.lang = language;
    localStorage.setItem("language", language);
  }, [language, i18n]);

  function setLanguage(lang: Language) {
    setLanguageState(lang);
  }

  function toggleLanguage() {
    setLanguageState((prev) => (prev === "en" ? "es" : "en"));
  }

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
