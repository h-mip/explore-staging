import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource } from "maplibre-gl";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { mapLibreContent, type MapLocale } from "../data/mapLibre";
import "./mapShare";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);

type Layer = "h3" | "municipality";
type View = "map" | "table";
type Confidence = "low" | "medium" | "high";
type ModelProperties = { confidence: Confidence; [key: string]: string | number };
type H3Properties = ModelProperties & { h3: string };
type MunicipalityProperties = ModelProperties & { municipality_code: string; name: string; comarca: string };
type H3Feature = Feature<Polygon, H3Properties>;
type MunicipalityFeature = Feature<Polygon | MultiPolygon, MunicipalityProperties>;
type ModelFeature = H3Feature | MunicipalityFeature;

type LayerMeta = {
  units: Record<MapLocale, string>;
  classBreaks: number[];
  featureCount: number;
  h3Resolution: number | null;
};
type MapMeta = {
  bounds: [number, number, number, number];
  defaultMonth: string;
  layers: { albopictus_h3: LayerMeta; albopictus_municipality: LayerMeta };
  boundaries: { source: string; license: string; municipalityCount: number; comarcaCount: number };
  basemap: { attribution: string };
};

const palette = ["#193754", "#2f718c", "#3d9d8b", "#83c77a", "#e5d875"] as const;
const emptySelection: FeatureCollection<Polygon | MultiPolygon> = { type: "FeatureCollection", features: [] };
const root = document.querySelector<HTMLElement>("[data-map-explorer]");

if (root) {
  void initializeMap(root).catch((error: unknown) => {
    console.error("H-MIP map could not start:", error);
    const locale = root.dataset.locale as MapLocale;
    const status = root.querySelector<HTMLElement>("[data-map-status]");
    if (status) {
      status.textContent = mapLibreContent[locale]?.error ?? "The map could not load.";
      status.hidden = false;
    }
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

function boundsOf(feature: ModelFeature): [[number, number], [number, number]] {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(value: unknown): void {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
      return;
    }
    value.forEach(visit);
  }
  visit(feature.geometry.coordinates);
  return [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
}

async function initializeMap(root: HTMLElement): Promise<void> {
  const locale = root.dataset.locale as MapLocale;
  const copy = mapLibreContent[locale];
  if (!copy) throw new Error(`Unsupported map locale: ${locale}`);

  const find = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing map element: ${selector}`);
    return element;
  };
  const mapElement = find<HTMLElement>("[data-maplibre-map]");
  const h3Url = root.dataset.h3Url;
  const municipalitiesUrl = root.dataset.municipalitiesUrl;
  const comarquesUrl = root.dataset.comarquesUrl;
  const metadataUrl = root.dataset.mapMetaUrl;
  if (!h3Url || !municipalitiesUrl || !comarquesUrl || !metadataUrl) {
    throw new Error("Missing generated map-data URLs");
  }

  // Municipality geometry is requested only when a municipality view or search needs it.
  const initialParams = new URLSearchParams(window.location.search);
  const loadMunicipalitiesInitially = initialParams.get("layer") === "municipality" || initialParams.get("view") === "table";
  const [metadata, h3Data, initialMunicipalities, comarquesData] = await Promise.all([
    fetchJson<MapMeta>(metadataUrl),
    fetchJson<FeatureCollection<Polygon, H3Properties>>(h3Url),
    loadMunicipalitiesInitially ? fetchJson<FeatureCollection<Polygon | MultiPolygon, MunicipalityProperties>>(municipalitiesUrl) : Promise.resolve(null),
    fetchJson<FeatureCollection<Polygon | MultiPolygon>>(comarquesUrl),
  ]);

  if (h3Data.features.length !== metadata.layers.albopictus_h3.featureCount ||
      (initialMunicipalities && initialMunicipalities.features.length !== metadata.layers.albopictus_municipality.featureCount)) {
    throw new Error("Generated map feature counts do not match metadata");
  }
  if (!Array.isArray(metadata.bounds) || metadata.bounds.length !== 4 ||
      metadata.bounds.some((value) => !Number.isFinite(value))) {
    throw new Error("Map metadata has invalid bounds");
  }
  for (const layer of [metadata.layers.albopictus_h3, metadata.layers.albopictus_municipality]) {
    const breaks = layer.classBreaks;
    if (!Array.isArray(breaks) || breaks.length !== 4 ||
        breaks.some((value, index) => !Number.isFinite(value) || value <= 0 ||
          (index > 0 && value <= breaks[index - 1]))) {
      throw new Error("Map metadata has invalid class breaks");
    }
  }

  const h3ById = new Map<string, H3Feature>(h3Data.features.map((feature) => [feature.properties.h3, feature]));
  let municipalitiesByCode = new Map<string, MunicipalityFeature>(
    (initialMunicipalities?.features ?? []).map((feature) => [feature.properties.municipality_code, feature]),
  );
  let municipalities = [...(initialMunicipalities?.features ?? [])];
  let municipalityDataPromise: Promise<void> | null = null;
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "").toLocaleLowerCase(locale).trim();
  const countFormatter = new Intl.NumberFormat(locale);
  const formatProbability = (value: number) => {
    const digits = value >= 1 ? 1 : value >= 0.1 ? 2 : value >= 0.01 ? 3 : value >= 0.001 ? 4 : 6;
    const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: value >= 1 ? 1 : 0, maximumFractionDigits: digits, useGrouping: false }).format(value);
    const suffix = metadata.layers.albopictus_h3.units[locale].match(/\(([^)]+)\)/)?.[1] ?? "";
    return `${formatted}${suffix ? (locale === "en" ? "" : " ") + suffix : ""}`;
  };
  const probabilityClass = (value: number, breaks: number[]) => breaks.findIndex((breakValue) => value < breakValue);
  const classIndex = (value: number, breaks: number[]) => {
    const index = probabilityClass(value, breaks);
    return index < 0 ? breaks.length : index;
  };
  const monthField = (month: number) => `m${String(month).padStart(2, "0")}`;
  const readValue = (feature: ModelFeature, month: number) => Number(feature.properties[monthField(month)]);
  const layerMeta = (layer: Layer) => layer === "h3" ? metadata.layers.albopictus_h3 : metadata.layers.albopictus_municipality;
  const currentFeature = () => state.area
    ? state.layer === "h3" ? h3ById.get(state.area) : municipalitiesByCode.get(state.area)
    : undefined;

  const params = initialParams;
  const requestedLatitude = Number(params.get("lat"));
  const requestedLongitude = Number(params.get("lon"));
  const requestedZoom = Number(params.get("zoom"));
  const hasPosition = params.has("lat") && params.has("lon") && params.has("zoom") &&
    Number.isFinite(requestedLatitude) && Number.isFinite(requestedLongitude) && Number.isFinite(requestedZoom) &&
    requestedLatitude >= metadata.bounds[1] && requestedLatitude <= metadata.bounds[3] &&
    requestedLongitude >= metadata.bounds[0] && requestedLongitude <= metadata.bounds[2] &&
    requestedZoom >= 4 && requestedZoom <= 17;
  const requestedMonth = params.get("month");
  const defaultMonth = /^m(0[1-9]|1[0-2])$/.test(metadata.defaultMonth) ? Number(metadata.defaultMonth.slice(1)) : 8;
  const initialMonth = requestedMonth !== null && /^(?:[1-9]|1[0-2])$/.test(requestedMonth)
    ? Number(requestedMonth) : defaultMonth;
  const requestedLayer = params.get("layer");
  const requestedView = params.get("view");
  const state: { layer: Layer; month: number; area: string | null; view: View } = {
    layer: requestedLayer === "municipality" ? "municipality" : "h3",
    month: initialMonth,
    area: null,
    view: requestedView === "table" ? "table" : "map",
  };
  if (state.view === "table") state.layer = "municipality";
  const requestedArea = params.get("area");
  if (requestedArea && (state.layer === "h3" ? h3ById.has(requestedArea) : municipalitiesByCode.has(requestedArea))) {
    state.area = requestedArea;
  }

  const fillExpression = (layer: Layer): ExpressionSpecification => {
    const breaks = layerMeta(layer).classBreaks;
    return ["step", ["to-number", ["get", monthField(state.month)]],
      palette[0], breaks[0], palette[1], breaks[1], palette[2], breaks[2], palette[3], breaks[3], palette[4]];
  };
  const [west, south, east, north] = metadata.bounds;
  const map = new MapLibreMap({
    container: mapElement,
    attributionControl: false,
    ...(hasPosition ? { center: [requestedLongitude, requestedLatitude] as [number, number], zoom: requestedZoom } : { bounds: [[west, south], [east, north]] as [[number, number], [number, number]], fitBoundsOptions: { padding: 28 } }),
    cooperativeGestures: true,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256,
          attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
        },
        h3: { type: "geojson", data: h3Data },
        municipalities: { type: "geojson", data: initialMunicipalities ?? emptySelection },
        comarques: {
          type: "geojson", data: comarquesData,
          attribution: '<a href="https://www.icgc.cat/" target="_blank" rel="noopener noreferrer">ICGC · CC BY 4.0</a>',
        },
        selection: { type: "geojson", data: emptySelection },
      },
      layers: [
        { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.7, "raster-saturation": -0.7, "raster-brightness-max": 0.62 } },
        { id: "h3-fill", type: "fill", source: "h3", paint: { "fill-color": fillExpression("h3"), "fill-opacity": 0.72 } },
        { id: "h3-outline", type: "line", source: "h3", paint: { "line-color": "rgba(255,255,255,0.18)", "line-width": 0.45 } },
        { id: "municipality-fill", type: "fill", source: "municipalities", layout: { visibility: "none" }, paint: { "fill-color": fillExpression("municipality"), "fill-opacity": 0.72 } },
        { id: "municipality-outline", type: "line", source: "municipalities", paint: { "line-color": "rgba(255,255,255,0.35)", "line-width": 0.55 } },
        { id: "comarca-outline", type: "line", source: "comarques", paint: { "line-color": "rgba(255,255,255,0.58)", "line-width": 1.15 } },
        { id: "selection-fill", type: "fill", source: "selection", paint: { "fill-color": "#ffffff", "fill-opacity": 0.16 } },
        { id: "selection-outline", type: "line", source: "selection", paint: { "line-color": "#ffffff", "line-width": 2.5 } },
      ],
    },
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new AttributionControl({ compact: false }), "bottom-right");
  let mapLoaded = false;
  let playback: ReturnType<typeof setInterval> | null = null;
  let tableDirty = true;
  let sortKey: "name" | "comarca" | "value" | "confidence" = "name";
  let sortDirection = 1;
  let suggestions: MunicipalityFeature[] = [];
  let activeSuggestion = -1;

  async function ensureMunicipalities(): Promise<void> {
    if (municipalities.length) return;
    if (municipalityDataPromise) return municipalityDataPromise;
    municipalityDataPromise = (async () => {
      const data = await fetchJson<FeatureCollection<Polygon | MultiPolygon, MunicipalityProperties>>(municipalitiesUrl);
      if (data.features.length !== metadata.layers.albopictus_municipality.featureCount) {
        throw new Error("Generated municipality count does not match metadata");
      }
      municipalities = [...data.features];
      municipalitiesByCode = new Map(data.features.map((feature) => [feature.properties.municipality_code, feature]));
      const source = map.getSource("municipalities") as GeoJSONSource | undefined;
      if (source) await source.setData(data);
      tableDirty = true;
    })();
    try { await municipalityDataPromise; }
    catch (error) { municipalityDataPromise = null; throw error; }
  }

  function reportMunicipalityLoadError(error: unknown): void {
    console.error("Could not load municipality data:", error);
    searchStatus.textContent = copy.error;
  }

  const monthInput = find<HTMLInputElement>("[data-month]");
  const playButton = find<HTMLButtonElement>("[data-play]");
  const searchForm = find<HTMLFormElement>("[data-search-form]");
  const searchInput = find<HTMLInputElement>("[data-search]");
  const searchClear = find<HTMLButtonElement>("[data-search-clear]");
  const searchResults = find<HTMLElement>("[data-search-form] [role=listbox]");
  const searchStatus = find<HTMLElement>("[data-search-status]");
  const tableFilter = find<HTMLInputElement>("[data-table-filter]");
  const tableBody = find<HTMLTableSectionElement>("[data-table-body]");

  function updateUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.set("layer", state.layer);
    url.searchParams.set("month", String(state.month));
    if (state.area) url.searchParams.set("area", state.area);
    else url.searchParams.delete("area");
    url.searchParams.set("view", state.view);
    if (mapLoaded) {
      const center = map.getCenter();
      url.searchParams.set("lat", center.lat.toFixed(4));
      url.searchParams.set("lon", center.lng.toFixed(4));
      url.searchParams.set("zoom", map.getZoom().toFixed(2));
    }
    window.history.replaceState(null, "", url);
    document.querySelectorAll<HTMLAnchorElement>(".language-switcher a[lang]").forEach((link) => {
      const target = new URL(link.href);
      target.search = url.search;
      link.href = target.href;
    });
    root.dispatchEvent(new Event("mapviewchange"));
  }

  function updateSelectionLayer(): void {
    if (!mapLoaded) return;
    const source = map.getSource("selection") as GeoJSONSource | undefined;
    const feature = currentFeature();
    void source?.setData(feature
      ? { type: "FeatureCollection", features: [feature] }
      : emptySelection);
  }

  function updateTableSelection(): void {
    tableBody.querySelectorAll<HTMLTableRowElement>("tr[data-area]").forEach((row) => {
      row.classList.toggle("is-selected", state.layer === "municipality" && row.dataset.area === state.area);
    });
  }

  function renderTable(): void {
    if (!tableDirty || state.view !== "table") return;
    tableDirty = false;
    const filter = normalize(tableFilter.value);
    const sorted = municipalities
      .filter((feature) => !filter || normalize(`${feature.properties.name} ${feature.properties.comarca}`).includes(filter))
      .sort((a, b) => {
        const ap = a.properties;
        const bp = b.properties;
        const comparison = sortKey === "value"
          ? readValue(a, state.month) - readValue(b, state.month)
          : sortKey === "confidence"
            ? ["low", "medium", "high"].indexOf(ap.confidence) - ["low", "medium", "high"].indexOf(bp.confidence)
            : ap[sortKey].localeCompare(bp[sortKey], locale);
        return comparison * sortDirection || ap.name.localeCompare(bp.name, locale);
      });
    const fragment = document.createDocumentFragment();
    for (const feature of sorted) {
      const code = feature.properties.municipality_code;
      const row = document.createElement("tr");
      row.dataset.area = code;
      const name = document.createElement("th");
      name.scope = "row";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = feature.properties.name;
      button.addEventListener("click", () => {
        selectArea("municipality", code, false);
        updateTableSelection();
      });
      name.append(button);
      const comarca = document.createElement("td");
      comarca.textContent = feature.properties.comarca;
      const value = document.createElement("td");
      value.className = "num";
      value.textContent = formatProbability(readValue(feature, state.month));
      const confidence = document.createElement("td");
      confidence.textContent = confidenceLabel(feature.properties.confidence);
      row.append(name, comarca, value, confidence);
      fragment.append(row);
    }
    tableBody.replaceChildren(fragment);
    find<HTMLElement>("[data-table-caption]").textContent = `${copy.tableCaption} ${copy.months[state.month - 1]} · ${layerMeta("municipality").units[locale]}`;
    find<HTMLElement>("[data-table-count]").textContent = `${sorted.length} ${copy.tableCount}`;
    find<HTMLElement>("[data-table-empty]").hidden = sorted.length !== 0;
    root.querySelectorAll<HTMLTableCellElement>("[data-sort-column]").forEach((header) => {
      if (header.dataset.sortColumn === sortKey) {
        header.setAttribute("aria-sort", sortDirection === 1 ? "ascending" : "descending");
      } else header.removeAttribute("aria-sort");
    });
    updateTableSelection();
  }

  function confidenceLabel(value: Confidence): string {
    return value === "low" ? copy.confidenceLow : value === "medium" ? copy.confidenceMedium : copy.confidenceHigh;
  }

  function renderSelected(): void {
    const feature = currentFeature();
    find<HTMLElement>("[data-select-prompt]").hidden = Boolean(feature);
    find<HTMLElement>("[data-selected-card]").hidden = !feature;
    if (!feature) return;
    const properties = feature.properties;
    find<HTMLElement>("[data-selected-name]").textContent = state.layer === "h3"
      ? `${copy.h3Cell} · ${(feature as H3Feature).properties.h3}`
      : (feature as MunicipalityFeature).properties.name;
    find<HTMLElement>("[data-selected-detail]").textContent = state.layer === "municipality"
      ? `${copy.comarca}: ${(feature as MunicipalityFeature).properties.comarca} · ${(feature as MunicipalityFeature).properties.municipality_code}`
      : "";
    const unit = layerMeta(state.layer).units[locale];
    const value = readValue(feature, state.month);
    const quality = copy.classNames[classIndex(value, layerMeta(state.layer).classBreaks)].toLocaleLowerCase(locale);
    find<HTMLElement>("[data-selected-summary]").textContent = locale === "en"
      ? `${copy.months[state.month - 1]}: ${quality} estimated probability (${formatProbability(value)}).`
      : locale === "es"
        ? `${copy.months[state.month - 1]}: probabilidad estimada ${quality} (${formatProbability(value)}).`
        : `${copy.months[state.month - 1]}: probabilitat estimada ${quality} (${formatProbability(value)}).`;
    find<HTMLElement>("[data-selected-confidence]").textContent = `${copy.confidence}: ${confidenceLabel(properties.confidence)}`;
    const values = copy.months.map((_, index) => readValue(feature, index + 1));
    const max = Math.max(...values, 0.001);
    find<HTMLOListElement>("[data-profile]").querySelectorAll<HTMLLIElement>("li").forEach((item, index) => {
      item.classList.toggle("is-current", index === state.month - 1);
      item.querySelector<HTMLElement>(".profile-bar")!.style.height = `${Math.max(3, values[index] / max * 65)}px`;
      item.querySelector<HTMLElement>(".profile-month")!.textContent = copy.monthShort[index].slice(0, 1);
      item.querySelector<HTMLElement>("[data-profile-value]")!.textContent = `${copy.months[index]}: ${formatProbability(values[index])}`;
    });
  }

  function render(): void {
    root.querySelectorAll<HTMLButtonElement>("[data-layer]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.layer === state.layer));
    });
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
    });
    find<HTMLElement>("[data-layer-hint]").textContent = state.layer === "h3"
      ? `${countFormatter.format(metadata.layers.albopictus_h3.featureCount)} ${copy.h3Hint} · ${copy.resolution} ${metadata.layers.albopictus_h3.h3Resolution ?? "?"}`
      : `${countFormatter.format(metadata.layers.albopictus_municipality.featureCount)} ${copy.municipalityHint}`;
    monthInput.value = String(state.month);
    find<HTMLElement>("[data-month-name]").textContent = copy.months[state.month - 1];
    root.querySelectorAll<HTMLElement>(".month-ticks span").forEach((tick, index) => tick.classList.toggle("active", index === state.month - 1));
    const breaks = layerMeta(state.layer).classBreaks;
    const labels = [`<${formatProbability(breaks[0])}`, `${formatProbability(breaks[0])}–<${formatProbability(breaks[1])}`, `${formatProbability(breaks[1])}–<${formatProbability(breaks[2])}`, `${formatProbability(breaks[2])}–<${formatProbability(breaks[3])}`, `≥${formatProbability(breaks[3])}`];
    find<HTMLElement>("[data-legend-title]").textContent = layerMeta(state.layer).units[locale];
    find<HTMLElement>("[data-legend-labels]").querySelectorAll<HTMLElement>("span").forEach((label, index) => { label.textContent = `${copy.classNames[index]}\n${labels[index]}`; });
    renderSelected();
    if (mapLoaded) {
      map.setLayoutProperty("h3-fill", "visibility", state.layer === "h3" ? "visible" : "none");
      map.setLayoutProperty("h3-outline", "visibility", state.layer === "h3" ? "visible" : "none");
      map.setLayoutProperty("municipality-fill", "visibility", state.layer === "municipality" ? "visible" : "none");
      map.setPaintProperty("h3-fill", "fill-color", fillExpression("h3"));
      map.setPaintProperty("municipality-fill", "fill-color", fillExpression("municipality"));
      updateSelectionLayer();
      find<HTMLElement>("[data-map-stage]").hidden = state.view === "table";
      find<HTMLElement>("[data-table-panel]").hidden = state.view === "map";
      if (state.view === "map") requestAnimationFrame(() => map.resize());
    }
    renderTable();
    updateTableSelection();
    updateUrl();
  }

  function stopPlayback(): void {
    if (playback !== null) clearInterval(playback);
    playback = null;
    playButton.setAttribute("aria-pressed", "false");
    playButton.textContent = `▶ ${copy.play}`;
  }

  function selectArea(layer: Layer, id: string, fit: boolean): void {
    if (!(layer === "h3" ? h3ById.has(id) : municipalitiesByCode.has(id))) return;
    stopPlayback();
    state.layer = layer;
    state.area = id;
    render();
    const feature = currentFeature();
    if (fit && feature) {
      map.fitBounds(boundsOf(feature), { padding: 72, maxZoom: 12, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650 });
    }
  }

  function searchMatches(queryText: string): MunicipalityFeature[] {
    const query = normalize(queryText);
    if (!query) return [];
    const rank = (feature: MunicipalityFeature) => {
      const name = normalize(feature.properties.name);
      const comarca = normalize(feature.properties.comarca);
      return name === query ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : comarca.includes(query) ? 3 : 4;
    };
    return municipalities
      .filter((feature) => normalize(`${feature.properties.name} ${feature.properties.comarca}`).includes(query))
      .sort((a, b) => rank(a) - rank(b) || a.properties.name.localeCompare(b.properties.name, locale))
      .slice(0, 8);
  }

  function closeSuggestions(): void {
    suggestions = [];
    activeSuggestion = -1;
    searchResults.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
  }

  function setActiveSuggestion(index: number): void {
    activeSuggestion = index;
    searchResults.querySelectorAll<HTMLElement>("[role=option]").forEach((option, optionIndex) => {
      option.setAttribute("aria-selected", String(optionIndex === index));
      if (optionIndex === index) option.scrollIntoView({ block: "nearest" });
    });
    if (index >= 0) searchInput.setAttribute("aria-activedescendant", `map-search-option-${index}`);
    else searchInput.removeAttribute("aria-activedescendant");
  }

  function chooseMunicipality(feature: MunicipalityFeature): void {
    searchInput.value = feature.properties.name;
    searchClear.hidden = false;
    searchStatus.textContent = "";
    closeSuggestions();
    state.view = "map";
    selectArea("municipality", feature.properties.municipality_code, true);
  }

  function showSuggestions(): void {
    searchClear.hidden = !searchInput.value;
    suggestions = searchMatches(searchInput.value);
    activeSuggestion = -1;
    searchResults.replaceChildren();
    if (!suggestions.length) { closeSuggestions(); return; }
    suggestions.forEach((feature, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `map-search-option-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      const title = document.createElement("strong");
      title.textContent = feature.properties.name;
      const detail = document.createElement("small");
      detail.textContent = feature.properties.comarca;
      option.append(title, detail);
      option.addEventListener("click", () => chooseMunicipality(feature));
      searchResults.append(option);
    });
    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  root.querySelectorAll<HTMLButtonElement>("[data-layer]").forEach((button) => {
    button.addEventListener("click", async () => {
      const next = button.dataset.layer as Layer;
      if (next === state.layer && state.view === "map") return;
      if (next === "municipality") {
        try { await ensureMunicipalities(); } catch (error) { reportMunicipalityLoadError(error); return; }
      }
      stopPlayback();
      state.layer = next;
      state.area = null;
      if (next === "h3") state.view = "map";
      render();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.view === "table") {
        try { await ensureMunicipalities(); } catch (error) { reportMunicipalityLoadError(error); return; }
      }
      stopPlayback();
      state.view = button.dataset.view as View;
      if (state.view === "table") {
        if (state.layer !== "municipality") state.area = null;
        state.layer = "municipality";
        tableDirty = true;
      }
      render();
    });
  });
  monthInput.addEventListener("input", () => {
    stopPlayback();
    state.month = Math.max(1, Math.min(12, Number(monthInput.value)));
    tableDirty = true;
    render();
  });
  playButton.addEventListener("click", () => {
    if (playback !== null) { stopPlayback(); return; }
    playButton.setAttribute("aria-pressed", "true");
    playButton.textContent = `❚❚ ${copy.pause}`;
    playback = setInterval(() => {
      state.month = state.month % 12 + 1;
      tableDirty = true;
      render();
    }, 1300);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlayback(); });
  searchInput.addEventListener("focus", () => { void ensureMunicipalities().then(showSuggestions).catch(reportMunicipalityLoadError); });
  searchInput.addEventListener("input", () => { searchStatus.textContent = ""; showSuggestions(); });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeSuggestions(); return; }
    if (!suggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((activeSuggestion + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    }
    if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      chooseMunicipality(suggestions[activeSuggestion]);
    }
  });
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await ensureMunicipalities(); } catch (error) { reportMunicipalityLoadError(error); return; }
    const match = suggestions[activeSuggestion >= 0 ? activeSuggestion : 0] ?? searchMatches(searchInput.value)[0];
    if (match) chooseMunicipality(match);
    else searchStatus.textContent = copy.searchMiss;
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.hidden = true;
    searchStatus.textContent = "";
    closeSuggestions();
    searchInput.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!searchForm.contains(event.target as Node)) closeSuggestions();
  });
  tableFilter.addEventListener("input", () => { tableDirty = true; renderTable(); });
  root.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.sort as typeof sortKey;
      sortDirection = next === sortKey ? -sortDirection : 1;
      sortKey = next;
      tableDirty = true;
      renderTable();
    });
  });
  find<HTMLButtonElement>("[data-show-on-map]").addEventListener("click", () => {
    state.view = "map";
    render();
    const feature = currentFeature();
    if (feature) map.fitBounds(boundsOf(feature), { padding: 72, maxZoom: 12, duration: 0 });
  });

  map.on("click", (event) => {
    if (!mapLoaded) return;
    const layerId = state.layer === "h3" ? "h3-fill" : "municipality-fill";
    const feature = map.queryRenderedFeatures(event.point, { layers: [layerId] })[0];
    const id = state.layer === "h3" ? feature?.properties?.h3 : feature?.properties?.municipality_code;
    if (typeof id === "string") selectArea(state.layer, id, false);
  });
  for (const layerId of ["h3-fill", "municipality-fill"]) {
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  }
  map.on("error", (event) => { console.error("H-MIP map error:", event.error); });
  map.on("moveend", updateUrl);
  map.on("load", () => {
    mapLoaded = true;
    render();
    map.resize();
    const feature = currentFeature();
    if (feature && state.view === "map" && !hasPosition) map.fitBounds(boundsOf(feature), { padding: 72, maxZoom: 12, duration: 0 });
  });
  map.once("idle", () => { find<HTMLElement>("[data-map-status]").hidden = true; });
  render();
}
