import { useState, useEffect, useRef } from "react";
import {
  Theme,
  ThemeMode,
  themeList,
  applyTheme,
  loadSavedTheme,
  loadSavedThemeMode,
  saveTheme,
  getAutoTheme,
  getSystemThemePreference,
} from "./themes";

export function ThemeSwitcher() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(loadSavedTheme);
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadSavedThemeMode);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (themeMode !== "auto") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      setCurrentTheme(getAutoTheme());
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    // Fallback for older browsers
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [themeMode]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectTheme = (theme: Theme) => {
    setThemeMode(theme.id);
    setCurrentTheme(theme);
    saveTheme(theme.id);
    setIsOpen(false);
  };

  const handleSelectAuto = () => {
    setThemeMode("auto");
    setCurrentTheme(getAutoTheme());
    saveTheme("auto");
    setIsOpen(false);
  };

  const systemPreference = getSystemThemePreference();

  return (
    <div className="theme-switcher" ref={dropdownRef}>
      <button
        className="theme-switcher-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current theme: ${themeMode === "auto" ? "Auto" : currentTheme.name}`}
      >
        <span className="theme-icon" aria-hidden="true">
          {themeMode === "auto" ? (
            <span>🌓</span>
          ) : (
            <ThemeIcon themeId={currentTheme.id} />
          )}
        </span>
        <span className="theme-name">
          {themeMode === "auto" ? "Auto" : currentTheme.name}
        </span>
        <span className="theme-chevron" aria-hidden="true">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {isOpen && (
        <div className="theme-dropdown" role="listbox" aria-label="Select theme">
          {/* Auto option at the top */}
          <button
            className={`theme-option ${themeMode === "auto" ? "active" : ""}`}
            role="option"
            aria-selected={themeMode === "auto"}
            onClick={handleSelectAuto}
          >
            <span className="theme-option-preview">
              <span
                className="theme-color-dot theme-color-dot-half"
                style={{
                  background: `linear-gradient(135deg, #ffffff 50%, #0d1117 50%)`,
                }}
              />
            </span>
            <span className="theme-option-info">
              <span className="theme-option-name">Auto</span>
              <span className="theme-option-desc">
                Follow system ({systemPreference === "dark" ? "Dark" : "Light"})
              </span>
            </span>
            {themeMode === "auto" && (
              <span className="theme-check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>

          <div className="theme-dropdown-divider" />

          {themeList.map((theme) => (
            <button
              key={theme.id}
              className={`theme-option ${themeMode === theme.id ? "active" : ""}`}
              role="option"
              aria-selected={themeMode === theme.id}
              onClick={() => handleSelectTheme(theme)}
            >
              <span className="theme-option-preview">
                <span
                  className="theme-color-dot"
                  style={{ background: theme.colors.bgPrimary }}
                />
                <span
                  className="theme-color-dot"
                  style={{ background: theme.colors.accent }}
                />
              </span>
              <span className="theme-option-info">
                <span className="theme-option-name">{theme.name}</span>
                <span className="theme-option-desc">{theme.description}</span>
              </span>
              {themeMode === theme.id && (
                <span className="theme-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Theme icons for visual distinction
function ThemeIcon({ themeId }: { themeId: string }) {
  switch (themeId) {
    case "midnight-ocean":
      return <span>🌊</span>;
    case "arctic-light":
      return <span>❄️</span>;
    case "ember-glow":
      return <span>🔥</span>;
    case "forest-depth":
      return <span>🌲</span>;
    case "high-contrast":
      return <span>◐</span>;
    case "dracula":
      return <span>🧛</span>;
    case "nord":
      return <span>🏔️</span>;
    case "solarized-dark":
      return <span>☀️</span>;
    case "github-dark":
      return <span>🐙</span>;
    default:
      return <span>🎨</span>;
  }
}
