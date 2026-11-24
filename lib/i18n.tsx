"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";

export type Messages = Record<string, string>;
export type LocaleMessages = Record<string, Partial<Messages>>;

type LocaleContextValue = {
  locale?: string;
  messages: LocaleMessages;
};

const NO_MESSAGES: LocaleMessages = {};
const LocaleContext = createContext<LocaleContextValue>({ messages: NO_MESSAGES });

export function formatNumber(value: number, locale?: string) {
  return locale ? new Intl.NumberFormat(locale).format(value) : String(value);
}

export interface LocaleProviderProps {
  locale: string;
  messages?: LocaleMessages;
  children: ReactNode;
}

export function LocaleProvider({ locale, messages = NO_MESSAGES, children }: LocaleProviderProps) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): { locale?: string } {
  return { locale: useContext(LocaleContext).locale };
}

export function useMessages<T extends Messages>(
  namespace: string,
  defaults: T,
  labels?: Partial<T>,
) {
  const { locale, messages } = useContext(LocaleContext);
  const provided = messages[namespace];
  // Label objects are small static maps, so a JSON key keeps the t callback
  // stable across renders without requiring callers to memoize their labels.
  // This intentionally only supports JSON-serializable labels.
  const labelsKey = labels ? JSON.stringify(labels) : "";
  const stableLabels = useMemo(
    () => (labelsKey ? (JSON.parse(labelsKey) as Partial<T>) : undefined),
    [labelsKey],
  );

  return useCallback(
    (key: keyof T & string, values?: Record<string, string | number>) => {
      const template = stableLabels?.[key] ?? provided?.[key] ?? defaults[key];
      if (!values) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = values[name];
        if (value === undefined) return match;
        return typeof value === "number" ? formatNumber(value, locale) : value;
      });
    },
    [defaults, stableLabels, locale, provided],
  );
}
