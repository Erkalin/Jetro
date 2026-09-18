// Central language registry — order matters for the picker.
// English + Farsi are always pinned first; the rest follow in this order.
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
  /** Native name shown in the dropdown (e.g. "Deutsch", "فارسی"). */
  nativeName: string;
  /** English name (tooltip / accessibility). */
  englishName: string;
  /** ISO 3166-1 alpha-2 country code for the flag image (see FlagIcon). */
  country: string;
  dir: 'ltr' | 'rtl';
  /** BCP-47 tag for <html lang> + date/number formatting. */
  locale: string;
}

export const LANG_KEY = 'jetro-lang';

export const PINNED_LANGUAGES: Language[] = ['en', 'fa'];

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', country: 'gb', dir: 'ltr', locale: 'en-US' },
  { code: 'fa', nativeName: 'فارسی', englishName: 'Persian', country: 'ir', dir: 'rtl', locale: 'fa-IR' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', country: 'sa', dir: 'rtl', locale: 'ar-SA' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', country: 'tr', dir: 'ltr', locale: 'tr-TR' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', country: 'fr', dir: 'ltr', locale: 'fr-FR' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', country: 'de', dir: 'ltr', locale: 'de-DE' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', country: 'es', dir: 'ltr', locale: 'es-ES' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', country: 'ru', dir: 'ltr', locale: 'ru-RU' },
  { code: 'zh', nativeName: '简体中文', englishName: 'Chinese (Simplified)', country: 'cn', dir: 'ltr', locale: 'zh-CN' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', country: 'in', dir: 'ltr', locale: 'hi-IN' },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', country: 'pt', dir: 'ltr', locale: 'pt-PT' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', country: 'it', dir: 'ltr', locale: 'it-IT' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', country: 'nl', dir: 'ltr', locale: 'nl-NL' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', country: 'jp', dir: 'ltr', locale: 'ja-JP' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', country: 'kr', dir: 'ltr', locale: 'ko-KR' },
  { code: 'ur', nativeName: 'اردو', englishName: 'Urdu', country: 'pk', dir: 'rtl', locale: 'ur-PK' },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian', country: 'id', dir: 'ltr', locale: 'id-ID' },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish', country: 'pl', dir: 'ltr', locale: 'pl-PL' },
  { code: 'uk', nativeName: 'Українська', englishName: 'Ukrainian', country: 'ua', dir: 'ltr', locale: 'uk-UA' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese', country: 'vn', dir: 'ltr', locale: 'vi-VN' },
  { code: 'zhTW', nativeName: '繁體中文', englishName: 'Chinese (Traditional)', country: 'tw', dir: 'ltr', locale: 'zh-TW' },
  { code: 'he', nativeName: 'עברית', englishName: 'Hebrew', country: 'il', dir: 'rtl', locale: 'he-IL' },
  { code: 'ku', nativeName: 'کوردی (سۆرانی)', englishName: 'Kurdish (Sorani)', country: 'ku', dir: 'rtl', locale: 'ckb-IQ' },
  { code: 'az', nativeName: 'Azərbaycanca', englishName: 'Azerbaijani', country: 'az', dir: 'ltr', locale: 'az-AZ' },
  { code: 'bn', nativeName: 'বাংলা', englishName: 'Bengali', country: 'bd', dir: 'ltr', locale: 'bn-BD' },
  { code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil', country: 'in', dir: 'ltr', locale: 'ta-IN' },
  { code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu', country: 'in', dir: 'ltr', locale: 'te-IN' },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai', country: 'th', dir: 'ltr', locale: 'th-TH' },
  { code: 'ms', nativeName: 'Bahasa Melayu', englishName: 'Malay', country: 'my', dir: 'ltr', locale: 'ms-MY' },
  { code: 'tl', nativeName: 'Filipino', englishName: 'Filipino', country: 'ph', dir: 'ltr', locale: 'fil-PH' },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish', country: 'se', dir: 'ltr', locale: 'sv-SE' },
  { code: 'no', nativeName: 'Norsk', englishName: 'Norwegian', country: 'no', dir: 'ltr', locale: 'nb-NO' },
  { code: 'da', nativeName: 'Dansk', englishName: 'Danish', country: 'dk', dir: 'ltr', locale: 'da-DK' },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish', country: 'fi', dir: 'ltr', locale: 'fi-FI' },
  { code: 'el', nativeName: 'Ελληνικά', englishName: 'Greek', country: 'gr', dir: 'ltr', locale: 'el-GR' },
  { code: 'hu', nativeName: 'Magyar', englishName: 'Hungarian', country: 'hu', dir: 'ltr', locale: 'hu-HU' },
  { code: 'cs', nativeName: 'Čeština', englishName: 'Czech', country: 'cz', dir: 'ltr', locale: 'cs-CZ' },
  { code: 'ro', nativeName: 'Română', englishName: 'Romanian', country: 'ro', dir: 'ltr', locale: 'ro-RO' },
  { code: 'ptBR', nativeName: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', country: 'br', dir: 'ltr', locale: 'pt-BR' },
  { code: 'es419', nativeName: 'Español (Latinoamérica)', englishName: 'Spanish (Latin America)', country: 'mx', dir: 'ltr', locale: 'es-419' },
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
