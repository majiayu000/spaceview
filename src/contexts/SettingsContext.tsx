import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, DEFAULT_SETTINGS, formatSize } from "../types";

interface SettingsContextValue {
  settings: Settings;
  updateSettings: (newSettings: Settings) => void;
  reloadSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const updateSettings = useCallback((newSettings: Settings) => {
    setSettings(newSettings);
  }, []);

  const reloadSettings = useCallback(async () => {
    await loadSettings();
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, reloadSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}

// Hook for getting formatted size with settings applied
export function useFormatSize(): (bytes: number) => string {
  const { settings } = useSettings();
  return useCallback(
    (bytes: number) => {
      return formatSize(bytes, settings.size_unit);
    },
    [settings.size_unit]
  );
}
