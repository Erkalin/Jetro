import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en';
import type { AppStrings } from './en';
import { fa } from './fa';
import { ar } from './ar';
import { tr } from './tr';
import { fr } from './fr';
import { de } from './de';
import { es } from './es';
import { ru } from './ru';
import { zh } from './zh';
import { hi } from './hi';
import { pt } from './pt';
import { it } from './it';
import { nl } from './nl';
import { ja } from './ja';
import { ko } from './ko';
import { ur } from './ur';
import { id } from './id';
import { pl } from './pl';
import { uk } from './uk';
import { vi } from './vi';
import { zhTW } from './zhTW';
import { he } from './he';
import { ku } from './ku';
import { az } from './az';
import { bn } from './bn';
import { ta } from './ta';
import { te } from './te';
import { th } from './th';
import { ms } from './ms';
import { tl } from './tl';
import { sv } from './sv';
import { no } from './no';
import { da } from './da';
import { fi } from './fi';
import { el } from './el';
import { hu } from './hu';
import { cs } from './cs';
import { ro } from './ro';
import { ptBR } from './ptBR';
import { es419 } from './es419';
import {
  LANGUAGE_MAP,
  LANG_KEY,
  languageDir as registryDir,
  normalizeLanguage as registryNormalize,
} from './languages';
import type { Language } from './languages';

export type { AppStrings };
export type { Language };
export { LANG_KEY } from './languages';

function readInitialLanguage(): Language {
  try {
    return registryNormalize(localStorage.getItem(LANG_KEY));
  } catch {
    return 'en';
  }
}

const STRINGS: Record<Language, AppStrings> = {
  en, fa, ar, tr, fr, de, es, ru, zh, hi,
  pt, it, nl, ja, ko, ur, id, pl, uk, vi,
  zhTW, he, ku, az, bn, ta, te, th, ms, tl,
  sv, no, da, fi, el, hu, cs, ro, ptBR, es419,
};

interface LanguageValue {
  lang: Language;
  setLang: (l: Language) => void;
  /** Active dictionary — all UI text lives here (one file per language). */
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
    const clean = registryNormalize(next);
    setLangState(clean);
    try {
      localStorage.setItem(LANG_KEY, clean);
    } catch {}
  };

  // Apply <html lang dir> + persist (instant, no flash on next launch via index.html bootstrap).
  useEffect(() => {
    try {
      document.documentElement.lang = LANGUAGE_MAP[lang]?.locale || lang;
      document.documentElement.dir = registryDir(lang);
      localStorage.setItem(LANG_KEY, lang);
    } catch {}
    // Lightweight language-switch animation: briefly tag <html> so CSS can
    // fade/slide the shell. Skipped on first mount so the app never animates on launch.
    if (firstMountRef.current) {
      firstMountRef.current = false;
      return;
    }
    const root = document.documentElement;
    root.classList.remove('lang-switch');
    // Force reflow so rapid language toggles retrigger the animation.
    void root.offsetWidth;
    root.classList.add('lang-switch');
    const timer = window.setTimeout(() => root.classList.remove('lang-switch'), 450);
    return () => window.clearTimeout(timer);
  }, [lang]);

  const value = useMemo<LanguageValue>(
    () => ({
      lang,
      setLang,
      t: STRINGS[lang] || en,
      dir: registryDir(lang),
      isRTL: registryDir(lang) === 'rtl',
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  return useContext(LanguageContext);
}
