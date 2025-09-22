import React from "react";
import { useI18n } from "@/i18n/context";

export default function LangSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <select
      className="input"
      value={lang}
      onChange={(e) => setLang(e.target.value)}
      style={{ width: 140 }}
      aria-label="Language"
      title="Language"
    >
      <option value="ar">🇲🇦 العربية</option>
      <option value="fr">🇫🇷 Français</option>
      <option value="en">🇬🇧 English</option>
    </select>
  );
}
