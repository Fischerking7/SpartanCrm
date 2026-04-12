import { Button } from "@/components/ui/button";
import { useLanguage } from "./language-provider";

export function LanguageToggle() {
  const { language, toggleLanguage } = useLanguage();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleLanguage}
      title={language === "en" ? "Switch to Spanish" : "Cambiar a inglés"}
      data-testid="button-language-toggle"
    >
      <span className="text-xs font-bold">{language === "en" ? "ES" : "EN"}</span>
    </Button>
  );
}
