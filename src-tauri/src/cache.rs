//! Scan result caching for instant reload
//!
//! Caches scan results to disk for near-instant loading on subsequent visits.
//! Cache is stored in ~/.cache/spaceview/ (macOS/Linux) or AppData (Windows).

use crate::scanner::FileNode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::BufReader;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Cache metadata and scan results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedScan {
    /// Version for cache format compatibility
    pub version: u32,
    /// Original scan path
    pub scan_path: String,
    /// Timestamp when scan was performed (unix epoch seconds)
    pub scanned_at: u64,
    /// Total files scanned
    pub total_files: u64,
    /// Total directories scanned
    pub total_dirs: u64,
    /// Total size in bytes
    pub total_size: u64,
    /// The scan result tree
    pub root: FileNode,
}

const CACHE_VERSION: u32 = 1;

/// Get the cache directory path
fn get_cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|p| p.join("spaceview"))
}

/// Generate a cache key from a path (SHA256 hash)
fn path_to_cache_key(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let result = hasher.finalize();
    format!("{:x}", result)[..16].to_string() // Use first 16 hex chars
}

/// Get the cache file path for a given scan path
fn get_cache_path(scan_path: &str) -> Option<PathBuf> {
    let cache_dir = get_cache_dir()?;
    let key = path_to_cache_key(scan_path);
    Some(cache_dir.join(format!("{}.bin", key)))
}

/// Maximum cache size (500MB) to prevent memory issues
const MAX_CACHE_SIZE: u64 = 500 * 1024 * 1024;

/// Save scan results to cache
pub fn save_to_cache(scan_path: &str, root: &FileNode) -> Result<PathBuf, String> {
    let cache_dir = get_cache_dir().ok_or("Could not determine cache directory")?;

    // Create cache directory if it doesn't exist
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    let cache_path = get_cache_path(scan_path)
        .ok_or("Could not determine cache path")?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_secs();

    // Count totals from the tree
    let (total_files, total_dirs) = count_items(root);

    let cached = CachedScan {
        version: CACHE_VERSION,
        scan_path: scan_path.to_string(),
        scanned_at: now,
        total_files,
        total_dirs,
        total_size: root.size,
        root: root.clone(),
    };

    // First serialize to bytes to check size
    let serialized = bincode::serialize(&cached)
        .map_err(|e| format!("Failed to serialize cache: {}", e))?;

    // Check if cache is too large
    if serialized.len() as u64 > MAX_CACHE_SIZE {
        return Err(format!(
            "Cache too large ({:.1} MB > {:.0} MB limit), skipping",
            serialized.len() as f64 / 1_048_576.0,
            MAX_CACHE_SIZE as f64 / 1_048_576.0
        ));
    }

    // Write to file
    fs::write(&cache_path, &serialized)
        .map_err(|e| format!("Failed to write cache file: {}", e))?;

    println!("[Cache] Saved to {:?} ({:.1} MB)", cache_path, serialized.len() as f64 / 1_048_576.0);
    Ok(cache_path)
}

/// Load scan results from cache
pub fn load_from_cache(scan_path: &str) -> Result<CachedScan, String> {
    let cache_path = get_cache_path(scan_path)
        .ok_or("Could not determine cache path")?;

    if !cache_path.exists() {
        return Err("Cache not found".to_string());
    }

    let file = fs::File::open(&cache_path)
        .map_err(|e| format!("Failed to open cache file: {}", e))?;
    let reader = BufReader::new(file);

    let cached: CachedScan = bincode::deserialize_from(reader)
        .map_err(|e| format!("Failed to deserialize cache: {}", e))?;

    // Check version compatibility
    if cached.version != CACHE_VERSION {
        return Err(format!("Cache version mismatch: {} vs {}", cached.version, CACHE_VERSION));
    }

    println!("[Cache] Loaded from {:?}", cache_path);
    println!("[Cache] Scanned at: {} ({} files, {} dirs, {:.2} GB)",
        cached.scanned_at,
        cached.total_files,
        cached.total_dirs,
        cached.total_size as f64 / 1_073_741_824.0
    );

    Ok(cached)
}

/// Check if cache exists for a path
#[allow(dead_code)]
pub fn has_cache(scan_path: &str) -> bool {
    get_cache_path(scan_path)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Get cache info without loading the full cache
pub fn get_cache_info(scan_path: &str) -> Option<CacheInfo> {
    let cache_path = get_cache_path(scan_path)?;

    if !cache_path.exists() {
        return None;
    }

    // Get file modification time as a proxy for cache freshness
    let metadata = fs::metadata(&cache_path).ok()?;
    let modified = metadata.modified().ok()?;
    let cache_time = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    let cache_size = metadata.len();

    Some(CacheInfo {
        cache_path: cache_path.to_string_lossy().to_string(),
        cached_at: cache_time,
        cache_size_bytes: cache_size,
    })
}

/// Delete cache for a path
pub fn delete_cache(scan_path: &str) -> Result<(), String> {
    let cache_path = get_cache_path(scan_path)
        .ok_or("Could not determine cache path")?;

    if cache_path.exists() {
        fs::remove_file(&cache_path)
            .map_err(|e| format!("Failed to delete cache: {}", e))?;
        println!("[Cache] Deleted {:?}", cache_path);
    }

    Ok(())
}

/// Clear all caches
pub fn clear_all_caches() -> Result<usize, String> {
    let cache_dir = get_cache_dir().ok_or("Could not determine cache directory")?;

    if !cache_dir.exists() {
        return Ok(0);
    }

    let mut count = 0;
    for entry in fs::read_dir(&cache_dir)
        .map_err(|e| format!("Failed to read cache directory: {}", e))?
    {
        if let Ok(entry) = entry {
            if entry.path().extension().map(|e| e == "bin").unwrap_or(false) {
                if fs::remove_file(entry.path()).is_ok() {
                    count += 1;
                }
            }
        }
    }

    println!("[Cache] Cleared {} cache files", count);
    Ok(count)
}

/// Count files and directories in a tree
fn count_items(node: &FileNode) -> (u64, u64) {
    if !node.is_dir {
        return (1, 0);
    }

    let mut files = 0u64;
    let mut dirs = 1u64; // Count this directory

    for child in &node.children {
        let (f, d) = count_items(child);
        files += f;
        dirs += d;
    }

    (files, dirs)
}

/// Cache info without loading full data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheInfo {
    pub cache_path: String,
    pub cached_at: u64,
    pub cache_size_bytes: u64,
}

/// Scan history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanHistoryEntry {
    pub scan_path: String,
    pub scanned_at: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_size: u64,
    pub cache_size_bytes: u64,
}

/// Get all cached scans as history entries
pub fn get_scan_history() -> Vec<ScanHistoryEntry> {
    let cache_dir = match get_cache_dir() {
        Some(dir) => dir,
        None => return vec![],
    };

    if !cache_dir.exists() {
        return vec![];
    }

    let mut entries: Vec<ScanHistoryEntry> = vec![];

    if let Ok(dir_entries) = fs::read_dir(&cache_dir) {
        for entry in dir_entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "bin").unwrap_or(false) {
                // Try to read just the header of the cache file
                if let Ok(file) = fs::File::open(&path) {
                    let reader = BufReader::new(file);
                    if let Ok(cached) = bincode::deserialize_from::<_, CachedScan>(reader) {
                        if cached.version == CACHE_VERSION {
                            let cache_size = fs::metadata(&path)
                                .map(|m| m.len())
                                .unwrap_or(0);

                            entries.push(ScanHistoryEntry {
                                scan_path: cached.scan_path,
                                scanned_at: cached.scanned_at,
                                total_files: cached.total_files,
                                total_dirs: cached.total_dirs,
                                total_size: cached.total_size,
                                cache_size_bytes: cache_size,
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort by most recent first
    entries.sort_by(|a, b| b.scanned_at.cmp(&a.scanned_at));

    entries
}
