import { useState, useEffect, useRef } from "react";
import { Theme, themeList, applyTheme, loadSavedTheme, saveTheme } from "./themes";

export function ThemeSwitcher() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(loadSavedTheme);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectTheme = (theme: Theme) => {
    setCurrentTheme(theme);
    saveTheme(theme.id);
    setIsOpen(false);
  };

  return (
    <div className="theme-switcher" ref={dropdownRef}>
      <button
        className="theme-switcher-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Current theme: ${currentTheme.name}`}
      >
        <span className="theme-icon" aria-hidden="true">
          <ThemeIcon themeId={currentTheme.id} />
        </span>
        <span className="theme-name">{currentTheme.name}</span>
        <span className="theme-chevron" aria-hidden="true">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {isOpen && (
        <div className="theme-dropdown" role="listbox" aria-label="Select theme">
          {themeList.map((theme) => (
            <button
              key={theme.id}
              className={`theme-option ${currentTheme.id === theme.id ? "active" : ""}`}
              role="option"
              aria-selected={currentTheme.id === theme.id}
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
              {currentTheme.id === theme.id && (
                <span className="theme-check" aria-hidden="true">✓</span>
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
    default:
      return <span>🎨</span>;
  }
}
