// SpaceView Theme System
// Each theme has a distinctive personality while maintaining readability

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: {
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    textPrimary: string;
    textSecondary: string;
    accent: string;
    accentHover: string;
    border: string;
    success: string;
    warning: string;
    error: string;
    // Treemap specific
    treemapBorder: string;
    treemapShadow: string;
  };
}

export const themes: Record<string, Theme> = {
  // Default: Deep space vibes with electric pink accent
  "midnight-ocean": {
    id: "midnight-ocean",
    name: "Midnight Ocean",
    description: "Deep blue depths with electric accents",
    colors: {
      bgPrimary: "#0d1117",
      bgSecondary: "#161b22",
      bgTertiary: "#21262d",
      textPrimary: "#f0f6fc",
      textSecondary: "#8b949e",
      accent: "#58a6ff",
      accentHover: "#79c0ff",
      border: "#30363d",
      success: "#3fb950",
      warning: "#d29922",
      error: "#f85149",
      treemapBorder: "rgba(0, 0, 0, 0.6)",
      treemapShadow: "rgba(0, 0, 0, 0.4)",
    },
  },

  // Clean, professional light theme
  "arctic-light": {
    id: "arctic-light",
    name: "Arctic Light",
    description: "Crisp and clean with cool undertones",
    colors: {
      bgPrimary: "#ffffff",
      bgSecondary: "#f6f8fa",
      bgTertiary: "#eaeef2",
      textPrimary: "#1f2328",
      textSecondary: "#656d76",
      accent: "#0969da",
      accentHover: "#0550ae",
      border: "#d0d7de",
      success: "#1a7f37",
      warning: "#9a6700",
      error: "#cf222e",
      treemapBorder: "rgba(0, 0, 0, 0.15)",
      treemapShadow: "rgba(0, 0, 0, 0.1)",
    },
  },

  // Warm amber/orange glow
  "ember-glow": {
    id: "ember-glow",
    name: "Ember Glow",
    description: "Warm amber tones with fiery accents",
    colors: {
      bgPrimary: "#1c1410",
      bgSecondary: "#261c15",
      bgTertiary: "#33241a",
      textPrimary: "#fef3e2",
      textSecondary: "#c9a882",
      accent: "#ff9f43",
      accentHover: "#ffb366",
      border: "#4a3828",
      success: "#7cb342",
      warning: "#ffa726",
      error: "#ef5350",
      treemapBorder: "rgba(0, 0, 0, 0.5)",
      treemapShadow: "rgba(255, 159, 67, 0.1)",
    },
  },

  // Nature-inspired forest green
  "forest-depth": {
    id: "forest-depth",
    name: "Forest Depth",
    description: "Lush greens inspired by nature",
    colors: {
      bgPrimary: "#0f1610",
      bgSecondary: "#182018",
      bgTertiary: "#1e2a1e",
      textPrimary: "#e8f5e9",
      textSecondary: "#a5c9a8",
      accent: "#66bb6a",
      accentHover: "#81c784",
      border: "#2e4a2e",
      success: "#4caf50",
      warning: "#ffb74d",
      error: "#e57373",
      treemapBorder: "rgba(0, 0, 0, 0.5)",
      treemapShadow: "rgba(102, 187, 106, 0.1)",
    },
  },

  // Maximum accessibility high contrast
  "high-contrast": {
    id: "high-contrast",
    name: "High Contrast",
    description: "Maximum visibility for accessibility",
    colors: {
      bgPrimary: "#000000",
      bgSecondary: "#0a0a0a",
      bgTertiary: "#1a1a1a",
      textPrimary: "#ffffff",
      textSecondary: "#e0e0e0",
      accent: "#00e5ff",
      accentHover: "#6effff",
      border: "#ffffff",
      success: "#00ff00",
      warning: "#ffff00",
      error: "#ff0000",
      treemapBorder: "rgba(255, 255, 255, 0.8)",
      treemapShadow: "rgba(0, 0, 0, 0.8)",
    },
  },

  // Popular Dracula theme - dark with vibrant purple accents
  "dracula": {
    id: "dracula",
    name: "Dracula",
    description: "Dark theme with vibrant purple accents",
    colors: {
      bgPrimary: "#282a36",
      bgSecondary: "#1e1f29",
      bgTertiary: "#44475a",
      textPrimary: "#f8f8f2",
      textSecondary: "#6272a4",
      accent: "#bd93f9",
      accentHover: "#ff79c6",
      border: "#44475a",
      success: "#50fa7b",
      warning: "#f1fa8c",
      error: "#ff5555",
      treemapBorder: "rgba(0, 0, 0, 0.5)",
      treemapShadow: "rgba(189, 147, 249, 0.15)",
    },
  },

  // Nord theme - arctic, bluish colors
  "nord": {
    id: "nord",
    name: "Nord",
    description: "Arctic, bluish color palette",
    colors: {
      bgPrimary: "#2e3440",
      bgSecondary: "#3b4252",
      bgTertiary: "#434c5e",
      textPrimary: "#eceff4",
      textSecondary: "#d8dee9",
      accent: "#88c0d0",
      accentHover: "#8fbcbb",
      border: "#4c566a",
      success: "#a3be8c",
      warning: "#ebcb8b",
      error: "#bf616a",
      treemapBorder: "rgba(0, 0, 0, 0.4)",
      treemapShadow: "rgba(136, 192, 208, 0.1)",
    },
  },

  // Solarized Dark - scientifically designed color scheme
  "solarized-dark": {
    id: "solarized-dark",
    name: "Solarized Dark",
    description: "Precision colors for machines and people",
    colors: {
      bgPrimary: "#002b36",
      bgSecondary: "#073642",
      bgTertiary: "#094857",
      textPrimary: "#fdf6e3",
      textSecondary: "#93a1a1",
      accent: "#268bd2",
      accentHover: "#2aa198",
      border: "#586e75",
      success: "#859900",
      warning: "#b58900",
      error: "#dc322f",
      treemapBorder: "rgba(0, 0, 0, 0.4)",
      treemapShadow: "rgba(38, 139, 210, 0.15)",
    },
  },

  // GitHub Dark - familiar GitHub look
  "github-dark": {
    id: "github-dark",
    name: "GitHub Dark",
    description: "Familiar GitHub dark mode colors",
    colors: {
      bgPrimary: "#0d1117",
      bgSecondary: "#161b22",
      bgTertiary: "#21262d",
      textPrimary: "#c9d1d9",
      textSecondary: "#8b949e",
      accent: "#58a6ff",
      accentHover: "#79c0ff",
      border: "#30363d",
      success: "#3fb950",
      warning: "#d29922",
      error: "#f85149",
      treemapBorder: "rgba(0, 0, 0, 0.5)",
      treemapShadow: "rgba(88, 166, 255, 0.1)",
    },
  },
};

export const themeList = Object.values(themes);
export const defaultTheme = "midnight-ocean";
export const defaultLightTheme = "arctic-light";
export const defaultDarkTheme = "midnight-ocean";

// Light themes list
export const lightThemes = new Set(["arctic-light"]);

// Check if a theme is a light theme
export function isLightTheme(themeId: string): boolean {
  return lightThemes.has(themeId);
}

// Get system color scheme preference
export function getSystemThemePreference(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark"; // Default to dark
}

// Get the appropriate theme based on system preference
export function getAutoTheme(): Theme {
  const preference = getSystemThemePreference();
  return preference === "light"
    ? themes[defaultLightTheme]
    : themes[defaultDarkTheme];
}

// Apply theme to document
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.style.setProperty("--bg-primary", theme.colors.bgPrimary);
  root.style.setProperty("--bg-secondary", theme.colors.bgSecondary);
  root.style.setProperty("--bg-tertiary", theme.colors.bgTertiary);
  root.style.setProperty("--text-primary", theme.colors.textPrimary);
  root.style.setProperty("--text-secondary", theme.colors.textSecondary);
  root.style.setProperty("--accent", theme.colors.accent);
  root.style.setProperty("--accent-hover", theme.colors.accentHover);
  root.style.setProperty("--border", theme.colors.border);
  root.style.setProperty("--success", theme.colors.success);
  root.style.setProperty("--warning", theme.colors.warning);
  root.style.setProperty("--error", theme.colors.error);
  root.style.setProperty("--treemap-border", theme.colors.treemapBorder);
  root.style.setProperty("--treemap-shadow", theme.colors.treemapShadow);

  // Set data attribute for potential CSS-only styling
  root.setAttribute("data-theme", theme.id);
}

// Theme mode: "auto" follows system, or specific theme id
export type ThemeMode = "auto" | string;

// Load saved theme mode from localStorage
export function loadSavedThemeMode(): ThemeMode {
  const savedMode = localStorage.getItem("spaceview-theme-mode");
  if (savedMode === "auto") {
    return "auto";
  }
  // Legacy support: check old key
  const savedThemeId = localStorage.getItem("spaceview-theme");
  if (savedThemeId && themes[savedThemeId]) {
    return savedThemeId;
  }
  return defaultTheme;
}

// Load the actual theme to apply based on mode
export function loadSavedTheme(): Theme {
  const mode = loadSavedThemeMode();
  if (mode === "auto") {
    return getAutoTheme();
  }
  if (themes[mode]) {
    return themes[mode];
  }
  return themes[defaultTheme];
}

// Save theme preference
export function saveTheme(themeId: string): void {
  localStorage.setItem("spaceview-theme", themeId);
  localStorage.setItem("spaceview-theme-mode", themeId);
}

// Check if auto mode is enabled
export function isAutoMode(): boolean {
  return loadSavedThemeMode() === "auto";
}
