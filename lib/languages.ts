/**
 * The plan languages this builder can author — a mirror of Scripture Studio's
 * LOCALES (src/lib/i18n.ts). A plan's `language` must be one the Studio
 * serves, because tools only surface plans in their own language, so a new
 * language lands in BOTH repos: here (this list, a narration voice per
 * provider in lib/tts.ts, the hosting env) and in the Studio (i18n + verse +
 * audio providers). Russian was added on both sides 2026-11.
 *
 * `translation` is the default label stamped on new plans (the Studio picks
 * the actual Bible by locale, so this is what leaders see, not a lookup key).
 */
export const LANGUAGES = ["en", "ar", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_INFO: Record<
  Language,
  { name: string; nativeName: string; translation: string; translationName: string; rtl: boolean }
> = {
  en: {
    name: "English",
    nativeName: "English",
    translation: "NIV",
    translationName: "New International Version",
    rtl: false,
  },
  ar: {
    name: "Arabic",
    nativeName: "العربية",
    translation: "NAV",
    translationName: "New Arabic Version — Ketab El Hayat (كتاب الحياة)",
    rtl: true,
  },
  ru: {
    name: "Russian",
    nativeName: "Русский",
    translation: "NRT",
    translationName: "New Russian Translation (Новый русский перевод)",
    rtl: false,
  },
};

export function isLanguage(x: unknown): x is Language {
  return typeof x === "string" && (LANGUAGES as readonly string[]).includes(x);
}

/** Narrow untrusted input (form fields, imported JSON, request bodies) to a known language. */
export function coerceLanguage(x: unknown, fallback: Language = "en"): Language {
  return isLanguage(x) ? x : fallback;
}

/** The translation label a fresh plan in this language starts with. */
export function defaultTranslation(language: Language): string {
  return LANGUAGE_INFO[language].translation;
}
