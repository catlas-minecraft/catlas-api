import type { FeatureTags, LocalizedText } from "./types.ts";

const ownValue = <T>(record: Readonly<Record<string, T>>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined;

export const resolveLocalizedText = (
  text: LocalizedText,
  locale: string | undefined,
  defaultLocale: string,
) => {
  if (locale) {
    const exact = ownValue(text, locale);
    if (exact) return exact;
    const base = locale.split("-")[0];
    const baseText = base ? ownValue(text, base) : undefined;
    if (baseText) return baseText;
  }
  return ownValue(text, defaultLocale) ?? Object.values(text)[0] ?? "";
};

export const resolveTaggedText = (tags: FeatureTags, tag: string, locale: string | undefined) => {
  if (locale) {
    const exact = ownValue(tags, `${tag}:${locale}`);
    if (exact) return exact;
    const base = locale.split("-")[0];
    const baseText = base ? ownValue(tags, `${tag}:${base}`) : undefined;
    if (baseText) return baseText;
  }
  return ownValue(tags, tag) ?? null;
};
