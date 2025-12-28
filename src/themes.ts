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
};

export const themeList = Object.values(themes);
export const defaultTheme = "midnight-ocean";

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

// Load saved theme from localStorage
export function loadSavedTheme(): Theme {
  const savedThemeId = localStorage.getItem("spaceview-theme");
  if (savedThemeId && themes[savedThemeId]) {
    return themes[savedThemeId];
  }
  return themes[defaultTheme];
}

// Save theme preference
export function saveTheme(themeId: string): void {
  localStorage.setItem("spaceview-theme", themeId);
}
