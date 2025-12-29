//! Application settings storage
//!
//! Stores user preferences in a JSON file in the app data directory.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Application settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Settings version for future migrations
    pub version: u32,
    /// Maximum scan depth (None = unlimited)
    pub max_scan_depth: Option<u32>,
    /// Patterns to ignore during scanning
    pub ignore_patterns: Vec<String>,
    /// Show hidden files (files starting with .)
    pub show_hidden_files: bool,
    /// Size unit preference: "si" (KB/MB/GB) or "binary" (KiB/MiB/GiB)
    pub size_unit: String,
    /// Default theme name (None = auto)
    pub default_theme: Option<String>,
    /// Enable scan result caching
    pub enable_cache: bool,
    /// Auto-expand large files panel on scan
    pub auto_expand_large_files: bool,
    /// Number of large files to show (10, 20, 50, 100)
    pub large_files_count: u32,
    /// Minimum file size for duplicate detection (in bytes)
    pub duplicate_min_size: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            max_scan_depth: None,
            ignore_patterns: vec![
                ".git".to_string(),
                ".svn".to_string(),
                ".hg".to_string(),
                "node_modules".to_string(),
                ".DS_Store".to_string(),
                "Thumbs.db".to_string(),
            ],
            show_hidden_files: false,
            size_unit: "si".to_string(),
            default_theme: None,
            enable_cache: true,
            auto_expand_large_files: false,
            large_files_count: 20,
            duplicate_min_size: 1024, // 1 KB
        }
    }
}

const SETTINGS_VERSION: u32 = 1;

/// Get the data directory path
fn get_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join("spaceview"))
}

/// Get the settings file path
fn get_settings_path() -> Option<PathBuf> {
    get_data_dir().map(|p| p.join("settings.json"))
}

/// Load settings from disk
pub fn load_settings() -> Settings {
    let path = match get_settings_path() {
        Some(p) => p,
        None => return Settings::default(),
    };

    if !path.exists() {
        return Settings::default();
    }

    match fs::read_to_string(&path) {
        Ok(content) => {
            let settings: Settings = serde_json::from_str(&content).unwrap_or_default();
            // Ensure version is current
            if settings.version < SETTINGS_VERSION {
                // Future: handle migrations here
            }
            settings
        }
        Err(_) => Settings::default(),
    }
}

/// Save settings to disk
pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let data_dir = get_data_dir().ok_or("Could not determine data directory")?;
    let path = get_settings_path().ok_or("Could not determine settings path")?;

    // Create data directory if it doesn't exist
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    // Ensure version is set
    let mut settings = settings.clone();
    settings.version = SETTINGS_VERSION;

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

/// Update a single setting value
pub fn update_setting<F>(updater: F) -> Result<Settings, String>
where
    F: FnOnce(&mut Settings),
{
    let mut settings = load_settings();
    updater(&mut settings);
    save_settings(&settings)?;
    Ok(settings)
}

/// Reset settings to defaults
pub fn reset_settings() -> Result<Settings, String> {
    let defaults = Settings::default();
    save_settings(&defaults)?;
    Ok(defaults)
}

/// Add an ignore pattern
pub fn add_ignore_pattern(pattern: &str) -> Result<Settings, String> {
    update_setting(|s| {
        if !s.ignore_patterns.contains(&pattern.to_string()) {
            s.ignore_patterns.push(pattern.to_string());
        }
    })
}

/// Remove an ignore pattern
pub fn remove_ignore_pattern(pattern: &str) -> Result<Settings, String> {
    update_setting(|s| {
        s.ignore_patterns.retain(|p| p != pattern);
    })
}

/// Check if a path matches any ignore pattern
#[allow(dead_code)]
pub fn should_ignore(path: &str, settings: &Settings) -> bool {
    let path_lower = path.to_lowercase();

    for pattern in &settings.ignore_patterns {
        let pattern_lower = pattern.to_lowercase();

        // Simple matching: check if the path ends with the pattern or contains it as a component
        if path_lower.ends_with(&format!("/{}", pattern_lower))
            || path_lower.contains(&format!("/{}/", pattern_lower))
            || path_lower == pattern_lower
        {
            return true;
        }
    }

    false
}
