export type ViewerLocale = "ja" | "en";

export type ViewerMessages = {
  readonly appName: string;
  readonly loadingWorlds: string;
  readonly worldsError: string;
  readonly worldUnavailable: string;
  readonly noWorlds: string;
  readonly loadingMap: string;
  readonly mapError: string;
  readonly retry: string;
  readonly world: string;
  readonly language: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
  readonly resetView: string;
  readonly coordinates: string;
  readonly visibleFeatures: string;
  readonly mapControls: string;
  readonly mapLabel: string;
  readonly selectWorld: string;
  readonly chooseAnotherWorld: string;
  readonly japanese: string;
  readonly english: string;
};

export const LOCALE_STORAGE_KEY = "catlas-viewer-ol:locale";

const messages: Record<ViewerLocale, ViewerMessages> = {
  en: {
    appName: "Catlas viewer",
    loadingWorlds: "Loading worlds…",
    worldsError: "Worlds could not be loaded.",
    worldUnavailable: "This world is not available.",
    noWorlds: "No worlds are available yet.",
    loadingMap: "Loading map data…",
    mapError: "Map data could not be loaded.",
    retry: "Retry",
    world: "World",
    language: "Language",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    resetView: "Reset view",
    coordinates: "Coordinates",
    visibleFeatures: "Visible map features",
    mapControls: "Map controls",
    mapLabel: "Interactive Catlas map",
    selectWorld: "Select a world",
    chooseAnotherWorld: "Choose another world from the list.",
    japanese: "Japanese",
    english: "English",
  },
  ja: {
    appName: "Catlas ビューア",
    loadingWorlds: "ワールドを読み込んでいます…",
    worldsError: "ワールドを読み込めませんでした。",
    worldUnavailable: "このワールドは利用できません。",
    noWorlds: "利用できるワールドがありません。",
    loadingMap: "地図データを読み込んでいます…",
    mapError: "地図データを読み込めませんでした。",
    retry: "再試行",
    world: "ワールド",
    language: "言語",
    zoomIn: "拡大",
    zoomOut: "縮小",
    resetView: "表示をリセット",
    coordinates: "座標",
    visibleFeatures: "表示中の地物",
    mapControls: "地図操作",
    mapLabel: "操作できる Catlas 地図",
    selectWorld: "ワールドを選択",
    chooseAnotherWorld: "一覧から別のワールドを選択してください。",
    japanese: "日本語",
    english: "英語",
  },
};

export const messagesFor = (locale: ViewerLocale): ViewerMessages => messages[locale];

export const isViewerLocale = (value: string | null | undefined): value is ViewerLocale =>
  value === "ja" || value === "en";

export const initialLocale = (): ViewerLocale => {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isViewerLocale(stored)) return stored;
    } catch {
      // Storage can be unavailable in privacy mode; use the browser language instead.
    }
    return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
  }
  return "en";
};

export const persistLocale = (locale: ViewerLocale) => {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage is an enhancement, not a requirement for using the viewer.
  }
};
