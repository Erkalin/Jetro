export type Language =
  | 'en'
  | 'fa'
  | 'ar'
  | 'tr'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'zh'
  | 'hi'
  | 'pt'
  | 'it'
  | 'nl'
  | 'ja'
  | 'ko'
  | 'ur'
  | 'id'
  | 'pl'
  | 'uk'
  | 'vi'
  | 'zhTW'
  | 'he'
  | 'ku'
  | 'az'
  | 'bn'
  | 'ta'
  | 'te'
  | 'th'
  | 'ms'
  | 'tl'
  | 'sv'
  | 'no'
  | 'da'
  | 'fi'
  | 'el'
  | 'hu'
  | 'cs'
  | 'ro'
  | 'ptBR'
  | 'es419';

export interface LanguageMeta {
  code: Language;
  nativeName: string;
  englishName: string;
  country: string;
  dir: 'ltr' | 'rtl';
  locale: string;
  weekStart: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  weekend: number[];
}

export const LANG_KEY = 'jetro-lang';

export const PINNED_LANGUAGES: Language[] = ['en', 'fa'];

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', country: 'gb', dir: 'ltr', locale: 'en-US', weekStart: 1, weekend: [0, 6] },
  { code: 'fa', nativeName: 'فارسی', englishName: 'Persian', country: 'ir', dir: 'rtl', locale: 'fa-IR', weekStart: 6, weekend: [5] },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', country: 'sa', dir: 'rtl', locale: 'ar-SA', weekStart: 0, weekend: [5, 6] },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', country: 'tr', dir: 'ltr', locale: 'tr-TR', weekStart: 1, weekend: [0, 6] },
  { code: 'fr', nativeName: 'Français', englishName: 'French', country: 'fr', dir: 'ltr', locale: 'fr-FR', weekStart: 1, weekend: [0, 6] },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', country: 'de', dir: 'ltr', locale: 'de-DE', weekStart: 1, weekend: [0, 6] },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', country: 'es', dir: 'ltr', locale: 'es-ES', weekStart: 1, weekend: [0, 6] },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', country: 'ru', dir: 'ltr', locale: 'ru-RU', weekStart: 1, weekend: [0, 6] },
  { code: 'zh', nativeName: '简体中文', englishName: 'Chinese (Simplified)', country: 'cn', dir: 'ltr', locale: 'zh-CN', weekStart: 1, weekend: [0, 6] },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', country: 'in', dir: 'ltr', locale: 'hi-IN', weekStart: 0, weekend: [0] },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', country: 'pt', dir: 'ltr', locale: 'pt-PT', weekStart: 0, weekend: [0, 6] },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', country: 'it', dir: 'ltr', locale: 'it-IT', weekStart: 1, weekend: [0, 6] },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', country: 'nl', dir: 'ltr', locale: 'nl-NL', weekStart: 1, weekend: [0, 6] },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', country: 'jp', dir: 'ltr', locale: 'ja-JP', weekStart: 0, weekend: [0, 6] },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', country: 'kr', dir: 'ltr', locale: 'ko-KR', weekStart: 0, weekend: [0, 6] },
  { code: 'ur', nativeName: 'اردو', englishName: 'Urdu', country: 'pk', dir: 'rtl', locale: 'ur-PK', weekStart: 0, weekend: [0, 6] },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian', country: 'id', dir: 'ltr', locale: 'id-ID', weekStart: 0, weekend: [0, 6] },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish', country: 'pl', dir: 'ltr', locale: 'pl-PL', weekStart: 1, weekend: [0, 6] },
  { code: 'uk', nativeName: 'Українська', englishName: 'Ukrainian', country: 'ua', dir: 'ltr', locale: 'uk-UA', weekStart: 1, weekend: [0, 6] },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese', country: 'vn', dir: 'ltr', locale: 'vi-VN', weekStart: 1, weekend: [0, 6] },
  { code: 'zhTW', nativeName: '繁體中文', englishName: 'Chinese (Traditional)', country: 'tw', dir: 'ltr', locale: 'zh-TW', weekStart: 0, weekend: [0, 6] },
  { code: 'he', nativeName: 'עברית', englishName: 'Hebrew', country: 'il', dir: 'rtl', locale: 'he-IL', weekStart: 0, weekend: [5, 6] },
  { code: 'ku', nativeName: 'کوردی (سۆرانی)', englishName: 'Kurdish (Sorani)', country: 'ku', dir: 'rtl', locale: 'ckb-IQ', weekStart: 6, weekend: [5, 6] },
  { code: 'az', nativeName: 'Azərbaycanca', englishName: 'Azerbaijani', country: 'az', dir: 'ltr', locale: 'az-AZ', weekStart: 1, weekend: [0, 6] },
  { code: 'bn', nativeName: 'বাংলা', englishName: 'Bengali', country: 'bd', dir: 'ltr', locale: 'bn-BD', weekStart: 0, weekend: [0, 6] },
  { code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil', country: 'in', dir: 'ltr', locale: 'ta-IN', weekStart: 0, weekend: [0] },
  { code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu', country: 'in', dir: 'ltr', locale: 'te-IN', weekStart: 0, weekend: [0] },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai', country: 'th', dir: 'ltr', locale: 'th-TH', weekStart: 0, weekend: [0, 6] },
  { code: 'ms', nativeName: 'Bahasa Melayu', englishName: 'Malay', country: 'my', dir: 'ltr', locale: 'ms-MY', weekStart: 1, weekend: [0, 6] },
  { code: 'tl', nativeName: 'Filipino', englishName: 'Filipino', country: 'ph', dir: 'ltr', locale: 'fil-PH', weekStart: 0, weekend: [0, 6] },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish', country: 'se', dir: 'ltr', locale: 'sv-SE', weekStart: 1, weekend: [0, 6] },
  { code: 'no', nativeName: 'Norsk', englishName: 'Norwegian', country: 'no', dir: 'ltr', locale: 'nb-NO', weekStart: 1, weekend: [0, 6] },
  { code: 'da', nativeName: 'Dansk', englishName: 'Danish', country: 'dk', dir: 'ltr', locale: 'da-DK', weekStart: 1, weekend: [0, 6] },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish', country: 'fi', dir: 'ltr', locale: 'fi-FI', weekStart: 1, weekend: [0, 6] },
  { code: 'el', nativeName: 'Ελληνικά', englishName: 'Greek', country: 'gr', dir: 'ltr', locale: 'el-GR', weekStart: 1, weekend: [0, 6] },
  { code: 'hu', nativeName: 'Magyar', englishName: 'Hungarian', country: 'hu', dir: 'ltr', locale: 'hu-HU', weekStart: 1, weekend: [0, 6] },
  { code: 'cs', nativeName: 'Čeština', englishName: 'Czech', country: 'cz', dir: 'ltr', locale: 'cs-CZ', weekStart: 1, weekend: [0, 6] },
  { code: 'ro', nativeName: 'Română', englishName: 'Romanian', country: 'ro', dir: 'ltr', locale: 'ro-RO', weekStart: 1, weekend: [0, 6] },
  { code: 'ptBR', nativeName: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', country: 'br', dir: 'ltr', locale: 'pt-BR', weekStart: 0, weekend: [0, 6] },
  { code: 'es419', nativeName: 'Español (Latinoamérica)', englishName: 'Spanish (Latin America)', country: 'mx', dir: 'ltr', locale: 'es-419', weekStart: 0, weekend: [0, 6] },
];

export const LANGUAGE_MAP: Record<Language, LanguageMeta> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l]),
) as Record<Language, LanguageMeta>;

const SUPPORTED_LANGUAGES: Language[] = LANGUAGES.map((l) => l.code);

const RTL_SET: Set<Language> = new Set(
  LANGUAGES.filter((l) => l.dir === 'rtl').map((l) => l.code),
);

export function normalizeLanguage(v: unknown): Language {
  if (typeof v === 'string' && (SUPPORTED_LANGUAGES as string[]).includes(v)) {
    return v as Language;
  }
  return 'en';
}

export function languageDir(lang: Language): 'ltr' | 'rtl' {
  return RTL_SET.has(lang) ? 'rtl' : 'ltr';
}

/** JS getDay() convention: 0 = Sunday … 6 = Saturday. */
export type WeekDayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function clampDay(n: unknown, fallback: WeekDayIndex): WeekDayIndex {
  const v = Math.round(Number(n));
  if (v >= 0 && v <= 6) return v as WeekDayIndex;
  return fallback;
}

/** Static per-country first day of week (CLDR). Storage always stays Sun..Sat. */
export function weekStartFor(lang: Language): WeekDayIndex {
  return clampDay(LANGUAGE_MAP[lang]?.weekStart ?? 1, 1);
}

/** Static per-country weekend days (CLDR). */
export function weekendFor(lang: Language): WeekDayIndex[] {
  const w = LANGUAGE_MAP[lang]?.weekend;
  if (Array.isArray(w) && w.length) {
    const out = w.map((d) => clampDay(d, -1 as any)).filter((d) => d >= 0) as WeekDayIndex[];
    if (out.length) return [...new Set(out)];
  }
  return [0, 6];
}

/**
 * Runtime first day of week from `Intl.Locale(...).weekInfo` (CLDR per BCP-47 tag).
 * Opt-in only: the scheduler uses the per-country table below as the source of
 * truth, because registry entries pair a country with a formatting locale
 * (e.g. `en` = country GB + locale en-US) and the country decides the week.
 */
export function weekStartForLocale(localeTag?: string, fallbackLang: Language = 'en'): WeekDayIndex {
  const fallback = weekStartFor(fallbackLang);
  try {
    const tag = String(localeTag || '').trim();
    if (!tag || typeof Intl === 'undefined' || !(Intl as any).Locale) return fallback;
    const loc: any = new (Intl as any).Locale(tag);
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    const first = Number(info?.firstDay);
    // Intl reports 1 = Monday … 7 = Sunday → convert to JS 0 = Sunday … 6 = Saturday.
    if (Number.isFinite(first) && first >= 1 && first <= 7) return ((first % 7) as WeekDayIndex);
  } catch {}
  return fallback;
}

/** Runtime weekend days from `Intl.Locale(...).weekInfo`. Opt-in only (see above). */
export function weekendForLocale(localeTag?: string, fallbackLang: Language = 'en'): WeekDayIndex[] {
  const fallback = weekendFor(fallbackLang);
  try {
    const tag = String(localeTag || '').trim();
    if (!tag || typeof Intl === 'undefined' || !(Intl as any).Locale) return fallback;
    const loc: any = new (Intl as any).Locale(tag);
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    const days = (info?.weekend as unknown) as Array<number | string> | undefined;
    if (Array.isArray(days) && days.length) {
      const out = days
        .map((d) => Number(d))
        .filter((d) => Number.isFinite(d) && d >= 1 && d <= 7)
        .map((d) => (d % 7) as WeekDayIndex);
      if (out.length) return [...new Set(out)];
    }
  } catch {}
  return fallback;
}

/**
 * Day indices (Sun..Sat storage) rotated so the country's first day comes first.
 * Source of truth is the per-country table (`weekStartFor`) — NOT the runtime
 * Intl locale tag, which can disagree with the country (e.g. `en` = GB/Monday
 * vs en-US/Sunday). Storage and scheduling logic always stay Sun..Sat.
 */
export function orderedWeekdayIndices(lang: Language): WeekDayIndex[] {
  const start = weekStartFor(lang);
  return ([0, 1, 2, 3, 4, 5, 6] as WeekDayIndex[]).map((_, k) => ((start + k) % 7) as WeekDayIndex);
}

/** Last day of the week for this country (start + 6). */
export function weekEndFor(lang: Language): WeekDayIndex {
  return (((weekStartFor(lang) + 6) % 7) as WeekDayIndex);
}
