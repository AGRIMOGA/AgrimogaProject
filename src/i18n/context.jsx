import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DICT } from "./dict";
import { loadJSON, saveJSON } from "@/Lib/storage";

const LS_LANG = "agrimoga:lang";
const I18nCtx = createContext({ lang: "ar", t: (k)=>k, setLang: ()=>{} });

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(loadJSON(LS_LANG, "ar"));

  useEffect(() => {
    saveJSON(LS_LANG, lang);
    // حدّث لغة واتجاه الصفحة
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const t = useMemo(() => {
    const dict = DICT[lang] || DICT.ar;
    return (key) => dict[key] ?? (DICT.ar[key] ?? key);
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  return useContext(I18nCtx);
}
