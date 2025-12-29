//! Favorites storage for quick access to frequently used paths
//!
//! Stores favorite files/folders in a JSON file in the app data directory.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// A favorited file or folder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Favorite {
    /// The full path to the file/folder
    pub path: String,
    /// Display name (file/folder name)
    pub name: String,
    /// Whether this is a directory
    pub is_dir: bool,
    /// Timestamp when favorited (unix epoch seconds)
    pub added_at: u64,
}

/// Favorites data structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct FavoritesData {
    version: u32,
    favorites: Vec<Favorite>,
}

const FAVORITES_VERSION: u32 = 1;

/// Get the data directory path
fn get_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join("spaceview"))
}

/// Get the favorites file path
fn get_favorites_path() -> Option<PathBuf> {
    get_data_dir().map(|p| p.join("favorites.json"))
}

/// Load favorites from disk
fn load_favorites_data() -> FavoritesData {
    let path = match get_favorites_path() {
        Some(p) => p,
        None => return FavoritesData::default(),
    };

    if !path.exists() {
        return FavoritesData::default();
    }

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => FavoritesData::default(),
    }
}

/// Save favorites to disk
fn save_favorites_data(data: &FavoritesData) -> Result<(), String> {
    let data_dir = get_data_dir().ok_or("Could not determine data directory")?;
    let path = get_favorites_path().ok_or("Could not determine favorites path")?;

    // Create data directory if it doesn't exist
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    let content = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize favorites: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("Failed to write favorites file: {}", e))?;

    Ok(())
}

/// Get all favorites
pub fn get_favorites() -> Vec<Favorite> {
    let data = load_favorites_data();
    // Filter out non-existent paths
    data.favorites
        .into_iter()
        .filter(|f| PathBuf::from(&f.path).exists())
        .collect()
}

/// Add a path to favorites
pub fn add_favorite(path: &str) -> Result<Favorite, String> {
    let path_buf = PathBuf::from(path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let mut data = load_favorites_data();

    // Check if already favorited
    if data.favorites.iter().any(|f| f.path == path) {
        return Err("Path is already in favorites".to_string());
    }

    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let is_dir = path_buf.is_dir();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_secs();

    let favorite = Favorite {
        path: path.to_string(),
        name,
        is_dir,
        added_at: now,
    };

    data.favorites.push(favorite.clone());
    data.version = FAVORITES_VERSION;

    save_favorites_data(&data)?;

    Ok(favorite)
}

/// Remove a path from favorites
pub fn remove_favorite(path: &str) -> Result<(), String> {
    let mut data = load_favorites_data();

    let original_len = data.favorites.len();
    data.favorites.retain(|f| f.path != path);

    if data.favorites.len() == original_len {
        return Err("Path is not in favorites".to_string());
    }

    save_favorites_data(&data)?;

    Ok(())
}

/// Check if a path is favorited
pub fn is_favorite(path: &str) -> bool {
    let data = load_favorites_data();
    data.favorites.iter().any(|f| f.path == path)
}

/// Clear all favorites
pub fn clear_favorites() -> Result<usize, String> {
    let data = load_favorites_data();
    let count = data.favorites.len();

    let empty_data = FavoritesData {
        version: FAVORITES_VERSION,
        favorites: vec![],
    };

    save_favorites_data(&empty_data)?;

    Ok(count)
}
