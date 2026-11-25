export type Locale = "en" | "es" | "ca";

export function internalUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return `${base}${path.replace(/^\/+/, "")}`;
}

// Home page of the main project site (h-mip.com) in each language. Catalan is at the root.
export const mainSiteUrls = {
  ca: "https://h-mip.com/",
  es: "https://h-mip.com/es/",
  en: "https://h-mip.com/en/",
} as const satisfies Record<Locale, string>;

export const routes = {
  en: {
    home: internalUrl("en/"),
    map: internalUrl("en/map/"),
    when: internalUrl("en/when/"),
    activities: internalUrl("en/activities/"),
    data: internalUrl("en/data/"),
    about: internalUrl("en/about/"),
    legal: internalUrl("en/legal/"),
    privacy: internalUrl("en/privacy/"),
    accessibility: internalUrl("en/accessibility/"),
    stories: internalUrl("en/stories/"),
  },
  es: {
    home: internalUrl("es/"),
    map: internalUrl("es/mapa/"),
    when: internalUrl("es/cuando/"),
    activities: internalUrl("es/actividades/"),
    data: internalUrl("es/datos/"),
    about: internalUrl("es/sobre/"),
    legal: internalUrl("es/aviso-legal/"),
    privacy: internalUrl("es/privacidad/"),
    accessibility: internalUrl("es/accesibilidad/"),
    stories: internalUrl("es/historias/"),
  },
  ca: {
    home: internalUrl(""),
    map: internalUrl("mapa/"),
    when: internalUrl("quan/"),
    activities: internalUrl("activitats/"),
    data: internalUrl("dades/"),
    about: internalUrl("sobre/"),
    legal: internalUrl("avis-legal/"),
    privacy: internalUrl("privacitat/"),
    accessibility: internalUrl("accessibilitat/"),
    stories: internalUrl("histories/"),
  },
} as const;
