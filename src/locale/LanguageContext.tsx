import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en';
import type { AppStrings } from './en';
import { fa } from './fa';

export type Language = 'en' | 'fa';
export type { AppStrings };

export const LANG_KEY = 'jetro-lang';

const STRINGS: Record<Language, AppStrings> = { en, fa };

export function normalizeLanguage(v: unknown): Language {
  return v === 'fa' ? 'fa' : 'en';
}

export function readInitialLanguage(): Language {
  try {
    return normalizeLanguage(localStorage.getItem(LANG_KEY));
  } catch {
    return 'en';
  }
}

export function languageDir(lang: Language): 'ltr' | 'rtl' {
  return lang === 'fa' ? 'rtl' : 'ltr';
}

interface LanguageValue {
  lang: Language;
  setLang: (l: Language) => void;
  /** Active dictionary — all UI text lives here (en.ts / fa.ts). */
  t: AppStrings;
  dir: 'ltr' | 'rtl';
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageValue>({
  lang: 'en',
  setLang: () => {},
  t: en,
  dir: 'ltr',
  isRTL: false,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => readInitialLanguage());
  const firstMountRef = useRef(true);

  const setLang = (next: Language) => {
    const clean = normalizeLanguage(next);
    setLangState(clean);
    try {
      localStorage.setItem(LANG_KEY, clean);
    } catch {}
  };

  // Apply <html lang dir> + persist (instant, no flash on next launch via index.html bootstrap).
  useEffect(() => {
    try {
      document.documentElement.lang = lang;
      document.documentElement.dir = languageDir(lang);
      localStorage.setItem(LANG_KEY, lang);
    } catch {}
    // Lightweight language-switch animation: briefly tag <html> so CSS can
    // fade/slide the shell + glide the segmented-control thumb. Skipped on
    // first mount so the app never animates on launch.
    if (firstMountRef.current) {
      firstMountRef.current = false;
      return;
    }
    const root = document.documentElement;
    root.classList.remove('lang-switch');
    // Force reflow so rapid EN<->FA toggles retrigger the animation.
    void root.offsetWidth;
    root.classList.add('lang-switch');
    const timer = window.setTimeout(() => root.classList.remove('lang-switch'), 450);
    return () => window.clearTimeout(timer);
  }, [lang]);

  const value = useMemo<LanguageValue>(
    () => ({
      lang,
      setLang,
      t: STRINGS[lang],
      dir: languageDir(lang),
      isRTL: lang === 'fa',
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  return useContext(LanguageContext);
}
