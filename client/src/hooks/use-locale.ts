import { useTranslation } from "react-i18next";

export function useLocale() {
  const { i18n } = useTranslation();
  return i18n.language === "es" ? "es-MX" : "en-US";
}

export function useLocaleFormatters() {
  const locale = useLocale();

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amount);

  const formatDate = (date: string | Date, options?: Intl.DateTimeFormatOptions) =>
    new Date(date).toLocaleDateString(locale, options);

  const formatDateTime = (date: string | Date, options?: Intl.DateTimeFormatOptions) =>
    new Date(date).toLocaleString(locale, options);

  return { locale, formatCurrency, formatDate, formatDateTime };
}
