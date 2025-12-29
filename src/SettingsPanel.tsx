import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, DEFAULT_SETTINGS, formatSize } from "./types";
import { themeList } from "./themes";
import { useErrorNotification } from "./contexts";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange: (settings: Settings) => void;
  onShowOnboarding?: () => void;
}

type TabId = "general" | "scan" | "appearance";

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  onSettingsChange,
  onShowOnboarding,
}) => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [newPattern, setNewPattern] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    general: null,
    scan: null,
    appearance: null,
  });
  const { showError, showInfo } = useErrorNotification();

  // Load settings on mount
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
      setError(null);
    } catch (err) {
      console.error("Failed to load settings:", err);
      setError("Failed to load settings");
    }
  };

  const saveSettings = async (newSettings: Settings) => {
    setIsSaving(true);
    try {
      await invoke("save_settings", { newSettings });
      setSettings(newSettings);
      onSettingsChange(newSettings);
      setError(null);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setError("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const resetToDefaults = async () => {
    try {
      const defaults = await invoke<Settings>("reset_settings");
      setSettings(defaults);
      onSettingsChange(defaults);
      setError(null);
    } catch (err) {
      console.error("Failed to reset settings:", err);
      setError("Failed to reset settings");
    }
  };

  const updateSetting = useCallback(<K extends keyof Settings>(
    key: K,
    value: Settings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveSettings(newSettings);
  }, [settings]);

  const addIgnorePattern = async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    if (settings.ignore_patterns.includes(pattern)) {
      setError("Pattern already exists");
      return;
    }
    try {
      const updated = await invoke<Settings>("add_ignore_pattern", { pattern });
      setSettings(updated);
      onSettingsChange(updated);
      setNewPattern("");
      setError(null);
    } catch (err) {
      console.error("Failed to add pattern:", err);
      setError("Failed to add pattern");
    }
  };

  const removeIgnorePattern = async (pattern: string) => {
    try {
      const updated = await invoke<Settings>("remove_ignore_pattern", { pattern });
      setSettings(updated);
      onSettingsChange(updated);
      setError(null);
    } catch (err) {
      console.error("Failed to remove pattern:", err);
      setError("Failed to remove pattern");
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
    // Focus trap - keep focus inside the modal
    if (e.key === "Tab" && panelRef.current) {
      const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }, [onClose]);

  // Handle tab keyboard navigation (arrow keys)
  const handleTabKeyDown = (e: React.KeyboardEvent, tabId: TabId) => {
    const tabs: TabId[] = ["general", "scan", "appearance"];
    const currentIndex = tabs.indexOf(tabId);

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % tabs.length;
      const nextTab = tabs[nextIndex];
      setActiveTab(nextTab);
      tabRefs.current[nextTab]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      const prevTab = tabs[prevIndex];
      setActiveTab(prevTab);
      tabRefs.current[prevTab]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveTab("general");
      tabRefs.current["general"]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveTab("appearance");
      tabRefs.current["appearance"]?.focus();
    }
  };

  // Focus management when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTimeout(() => closeButtonRef.current?.focus(), 0);
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen, handleKeyDown]);

  // Export settings to JSON file
  const handleExportSettings = async () => {
    try {
      const json = await invoke<string>("export_settings");
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `spaceview-settings-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showInfo("Settings exported successfully");
    } catch (err) {
      console.error("Failed to export settings:", err);
      showError(`Failed to export settings: ${err}`);
    }
  };

  // Import settings from JSON file
  const handleImportSettings = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const json = await file.text();
      const imported = await invoke<Settings>("import_settings", { json });
      setSettings(imported);
      onSettingsChange(imported);
      showInfo("Settings imported successfully");
      setError(null);
    } catch (err) {
      console.error("Failed to import settings:", err);
      showError(`Failed to import settings: ${err}`);
    }

    // Reset file input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <div className="settings-header">
          <h2 id="settings-dialog-title">Settings</h2>
          <button
            ref={closeButtonRef}
            className="close-btn"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close settings dialog"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && <div className="settings-error" role="alert">{error}</div>}

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          <button
            ref={(el) => { tabRefs.current.general = el; }}
            className={`settings-tab ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
            onKeyDown={(e) => handleTabKeyDown(e, "general")}
            role="tab"
            id="tab-general"
            aria-selected={activeTab === "general"}
            aria-controls="tabpanel-general"
            tabIndex={activeTab === "general" ? 0 : -1}
          >
            General
          </button>
          <button
            ref={(el) => { tabRefs.current.scan = el; }}
            className={`settings-tab ${activeTab === "scan" ? "active" : ""}`}
            onClick={() => setActiveTab("scan")}
            onKeyDown={(e) => handleTabKeyDown(e, "scan")}
            role="tab"
            id="tab-scan"
            aria-selected={activeTab === "scan"}
            aria-controls="tabpanel-scan"
            tabIndex={activeTab === "scan" ? 0 : -1}
          >
            Scanning
          </button>
          <button
            ref={(el) => { tabRefs.current.appearance = el; }}
            className={`settings-tab ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => setActiveTab("appearance")}
            onKeyDown={(e) => handleTabKeyDown(e, "appearance")}
            role="tab"
            id="tab-appearance"
            aria-selected={activeTab === "appearance"}
            aria-controls="tabpanel-appearance"
            tabIndex={activeTab === "appearance" ? 0 : -1}
          >
            Appearance
          </button>
        </div>

        <div className="settings-content">
          {activeTab === "general" && (
            <div
              className="settings-section"
              role="tabpanel"
              id="tabpanel-general"
              aria-labelledby="tab-general"
            >
              <div className="setting-item">
                <div className="setting-info">
                  <label>Size Unit Format</label>
                  <span className="setting-description">
                    SI uses 1000-based units (KB, MB, GB), Binary uses 1024-based (KiB, MiB, GiB)
                  </span>
                </div>
                <select
                  value={settings.size_unit}
                  onChange={(e) => updateSetting("size_unit", e.target.value as "si" | "binary")}
                  className="setting-select"
                >
                  <option value="si">SI (KB, MB, GB)</option>
                  <option value="binary">Binary (KiB, MiB, GiB)</option>
                </select>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label>Enable Caching</label>
                  <span className="setting-description">
                    Cache scan results for faster subsequent loads
                  </span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.enable_cache}
                    onChange={(e) => updateSetting("enable_cache", e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label>Auto-expand Large Files Panel</label>
                  <span className="setting-description">
                    Automatically show the large files panel after scanning
                  </span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.auto_expand_large_files}
                    onChange={(e) => updateSetting("auto_expand_large_files", e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label>Large Files Count</label>
                  <span className="setting-description">
                    Number of files to show in the large files panel
                  </span>
                </div>
                <select
                  value={settings.large_files_count}
                  onChange={(e) => updateSetting("large_files_count", parseInt(e.target.value))}
                  className="setting-select"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label>Duplicate Detection Min Size</label>
                  <span className="setting-description">
                    Minimum file size for duplicate detection ({formatSize(settings.duplicate_min_size)})
                  </span>
                </div>
                <select
                  value={settings.duplicate_min_size}
                  onChange={(e) => updateSetting("duplicate_min_size", parseInt(e.target.value))}
                  className="setting-select"
                >
                  <option value={1024}>1 KB</option>
                  <option value={10240}>10 KB</option>
                  <option value={102400}>100 KB</option>
                  <option value={1048576}>1 MB</option>
                  <option value={10485760}>10 MB</option>
                  <option value={104857600}>100 MB</option>
                </select>
              </div>

              {onShowOnboarding && (
                <div className="setting-item">
                  <div className="setting-info">
                    <label>Welcome Guide</label>
                    <span className="setting-description">
                      Show the interactive tour to learn SpaceView features
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      onShowOnboarding();
                      onClose();
                    }}
                    className="show-guide-btn"
                  >
                    Show Guide
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "scan" && (
            <div
              className="settings-section"
              role="tabpanel"
              id="tabpanel-scan"
              aria-labelledby="tab-scan"
            >
              <div className="setting-item">
                <div className="setting-info">
                  <label>Show Hidden Files</label>
                  <span className="setting-description">
                    Include files starting with "." in scan results
                  </span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.show_hidden_files}
                    onChange={(e) => updateSetting("show_hidden_files", e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label>Max Scan Depth</label>
                  <span className="setting-description">
                    Limit how deep to scan into subdirectories (empty = unlimited)
                  </span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="100"
                  placeholder="Unlimited"
                  value={settings.max_scan_depth ?? ""}
                  onChange={(e) => {
                    const value = e.target.value ? parseInt(e.target.value) : null;
                    updateSetting("max_scan_depth", value);
                  }}
                  className="setting-input setting-input-number"
                />
              </div>

              <div className="setting-item-full">
                <div className="setting-info">
                  <label>Ignore Patterns</label>
                  <span className="setting-description">
                    Skip directories/files matching these patterns during scan
                  </span>
                </div>
                <div className="ignore-patterns-container">
                  <div className="ignore-patterns-input">
                    <input
                      type="text"
                      placeholder="Enter pattern (e.g., .git, node_modules)"
                      value={newPattern}
                      onChange={(e) => setNewPattern(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addIgnorePattern();
                        }
                      }}
                      className="setting-input"
                    />
                    <button
                      onClick={addIgnorePattern}
                      className="add-pattern-btn"
                      disabled={!newPattern.trim()}
                    >
                      Add
                    </button>
                  </div>
                  <div className="ignore-patterns-list">
                    {settings.ignore_patterns.map((pattern) => (
                      <div key={pattern} className="ignore-pattern-tag">
                        <span>{pattern}</span>
                        <button
                          onClick={() => removeIgnorePattern(pattern)}
                          className="remove-pattern-btn"
                          title="Remove pattern"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "appearance" && (
            <div
              className="settings-section"
              role="tabpanel"
              id="tabpanel-appearance"
              aria-labelledby="tab-appearance"
            >
              <div className="setting-item">
                <div className="setting-info">
                  <label>Default Theme</label>
                  <span className="setting-description">
                    Theme to use on startup (Auto follows system preference)
                  </span>
                </div>
                <select
                  value={settings.default_theme ?? "auto"}
                  onChange={(e) => {
                    const value = e.target.value === "auto" ? null : e.target.value;
                    updateSetting("default_theme", value);
                  }}
                  className="setting-select"
                >
                  <option value="auto">Auto (System)</option>
                  {themeList.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="theme-preview-grid">
                {themeList.map((theme) => (
                  <button
                    key={theme.id}
                    className={`theme-preview-card ${settings.default_theme === theme.id ? "selected" : ""}`}
                    onClick={() => updateSetting("default_theme", theme.id)}
                  >
                    <div
                      className="theme-preview-colors"
                      style={{
                        background: theme.colors.bgPrimary,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <div
                        className="theme-preview-accent"
                        style={{ background: theme.colors.accent }}
                      />
                      <div
                        className="theme-preview-secondary"
                        style={{ background: theme.colors.bgSecondary }}
                      />
                    </div>
                    <span className="theme-preview-name">{theme.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <div className="settings-footer-left">
            <button
              onClick={resetToDefaults}
              className="reset-btn"
              disabled={isSaving}
              title="Reset all settings to defaults"
            >
              Reset to Defaults
            </button>
            <div className="import-export-btns">
              <button
                onClick={handleExportSettings}
                className="export-settings-btn"
                disabled={isSaving}
                title="Export settings to a JSON file"
              >
                <span aria-hidden="true">📤</span> Export
              </button>
              <button
                onClick={handleImportSettings}
                className="import-settings-btn"
                disabled={isSaving}
                title="Import settings from a JSON file"
              >
                <span aria-hidden="true">📥</span> Import
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json,application/json"
                style={{ display: "none" }}
              />
            </div>
          </div>
          <div className="settings-footer-right">
            {isSaving && <span className="saving-indicator">Saving...</span>}
            <button onClick={onClose} className="done-btn">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
