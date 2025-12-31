//! Scan result caching for instant reload (SQLite-backed).
//!
//! Stores scan snapshots in a local SQLite database to enable fast reloads
//! and incremental updates without re-walking the filesystem.

use crate::scanner::FileNode;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
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
    /// Timestamp of last incremental update (unix epoch seconds)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_incremental_at: Option<u64>,
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

/// Get the SQLite DB path
fn get_db_path() -> Option<PathBuf> {
    get_cache_dir().map(|p| p.join("spaceview.db"))
}

fn open_db() -> Result<Connection, String> {
    let db_path = get_db_path().ok_or("Could not determine cache directory")?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }

    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open cache DB: {}", e))?;

    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS scans (
          scan_path TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          scanned_at INTEGER NOT NULL,
          last_incremental_at INTEGER,
          total_files INTEGER NOT NULL,
          total_dirs INTEGER NOT NULL,
          total_size INTEGER NOT NULL,
          cache_size_bytes INTEGER NOT NULL,
          tree_blob BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS delete_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scan_path TEXT NOT NULL,
          target_path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          deleted_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("Failed to init cache DB: {}", e))?;

    Ok(conn)
}

/// Maximum cache size (500MB) to prevent memory issues
const MAX_CACHE_SIZE: u64 = 500 * 1024 * 1024;

/// Save scan results to cache (full scan)
pub fn save_to_cache(scan_path: &str, root: &FileNode) -> Result<PathBuf, String> {
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
        last_incremental_at: Some(now),
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

    let conn = open_db()?;
    conn.execute(
        r#"
        INSERT INTO scans (
          scan_path, version, scanned_at, last_incremental_at,
          total_files, total_dirs, total_size, cache_size_bytes, tree_blob
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(scan_path) DO UPDATE SET
          version = excluded.version,
          scanned_at = excluded.scanned_at,
          last_incremental_at = excluded.last_incremental_at,
          total_files = excluded.total_files,
          total_dirs = excluded.total_dirs,
          total_size = excluded.total_size,
          cache_size_bytes = excluded.cache_size_bytes,
          tree_blob = excluded.tree_blob
        "#,
        params![
            scan_path,
            CACHE_VERSION as i64,
            now as i64,
            now as i64,
            total_files as i64,
            total_dirs as i64,
            root.size as i64,
            serialized.len() as i64,
            serialized
        ],
    )
    .map_err(|e| format!("Failed to write cache DB: {}", e))?;

    Ok(get_db_path().unwrap_or_default())
}

/// Save incremental scan update (keeps original scanned_at)
pub fn save_incremental_update(scan_path: &str, root: &FileNode) -> Result<(), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_secs();

    let conn = open_db()?;
    let scanned_at: Option<i64> = conn
        .query_row(
            "SELECT scanned_at FROM scans WHERE scan_path = ?1",
            params![scan_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read cache metadata: {}", e))?;

    let scanned_at = scanned_at.unwrap_or(now as i64) as u64;

    let (total_files, total_dirs) = count_items(root);
    let cached = CachedScan {
        version: CACHE_VERSION,
        scan_path: scan_path.to_string(),
        scanned_at,
        last_incremental_at: Some(now),
        total_files,
        total_dirs,
        total_size: root.size,
        root: root.clone(),
    };

    let serialized = bincode::serialize(&cached)
        .map_err(|e| format!("Failed to serialize cache: {}", e))?;

    if serialized.len() as u64 > MAX_CACHE_SIZE {
        return Err(format!(
            "Cache too large ({:.1} MB > {:.0} MB limit), skipping",
            serialized.len() as f64 / 1_048_576.0,
            MAX_CACHE_SIZE as f64 / 1_048_576.0
        ));
    }

    conn.execute(
        r#"
        INSERT INTO scans (
          scan_path, version, scanned_at, last_incremental_at,
          total_files, total_dirs, total_size, cache_size_bytes, tree_blob
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(scan_path) DO UPDATE SET
          version = excluded.version,
          scanned_at = excluded.scanned_at,
          last_incremental_at = excluded.last_incremental_at,
          total_files = excluded.total_files,
          total_dirs = excluded.total_dirs,
          total_size = excluded.total_size,
          cache_size_bytes = excluded.cache_size_bytes,
          tree_blob = excluded.tree_blob
        "#,
        params![
            scan_path,
            CACHE_VERSION as i64,
            scanned_at as i64,
            now as i64,
            total_files as i64,
            total_dirs as i64,
            root.size as i64,
            serialized.len() as i64,
            serialized
        ],
    )
    .map_err(|e| format!("Failed to write cache DB: {}", e))?;

    Ok(())
}

/// Load scan results from cache
pub fn load_from_cache(scan_path: &str) -> Result<CachedScan, String> {
    let conn = open_db()?;
    let row = conn
        .query_row(
            r#"
            SELECT version, scanned_at, last_incremental_at,
                   total_files, total_dirs, total_size, tree_blob
            FROM scans
            WHERE scan_path = ?1
            "#,
            params![scan_path],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Vec<u8>>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read cache DB: {}", e))?;

    let Some((version, scanned_at, last_incremental_at, total_files, total_dirs, total_size, blob)) = row
    else {
        return Err("Cache not found".to_string());
    };

    if version as u32 != CACHE_VERSION {
        return Err(format!("Cache version mismatch: {} vs {}", version, CACHE_VERSION));
    }

    let cached: CachedScan = bincode::deserialize(&blob)
        .map_err(|e| format!("Failed to deserialize cache: {}", e))?;

    Ok(CachedScan {
        version: cached.version,
        scan_path: cached.scan_path,
        scanned_at: scanned_at as u64,
        last_incremental_at: last_incremental_at.map(|v| v as u64),
        total_files: total_files as u64,
        total_dirs: total_dirs as u64,
        total_size: total_size as u64,
        root: cached.root,
    })
}

/// Check if cache exists for a path
#[allow(dead_code)]
pub fn has_cache(scan_path: &str) -> bool {
    get_cache_info(scan_path).is_some()
}

/// Get cache info without loading the full cache
pub fn get_cache_info(scan_path: &str) -> Option<CacheInfo> {
    let conn = open_db().ok()?;
    let row = conn
        .query_row(
            r#"
            SELECT scanned_at, last_incremental_at, cache_size_bytes
            FROM scans
            WHERE scan_path = ?1
            "#,
            params![scan_path],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .ok()?;

    let (scanned_at, last_incremental_at, cache_size_bytes) = row?;
    let cached_at = last_incremental_at.unwrap_or(scanned_at);

    Some(CacheInfo {
        cache_path: get_db_path()?.to_string_lossy().to_string(),
        cached_at: cached_at as u64,
        cache_size_bytes: cache_size_bytes as u64,
    })
}

/// Delete cache for a path
pub fn delete_cache(scan_path: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM scans WHERE scan_path = ?1", params![scan_path])
        .map_err(|e| format!("Failed to delete cache: {}", e))?;
    Ok(())
}

/// Clear all caches
pub fn clear_all_caches() -> Result<usize, String> {
    let conn = open_db()?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM scans", [], |row| row.get(0))
        .unwrap_or(0);
    conn.execute("DELETE FROM scans", [])
        .map_err(|e| format!("Failed to clear cache: {}", e))?;
    let _ = conn.execute("DELETE FROM delete_log", []);
    Ok(count as usize)
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
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut stmt = match conn.prepare(
        r#"
        SELECT scan_path, scanned_at, total_files, total_dirs, total_size, cache_size_bytes
        FROM scans
        ORDER BY scanned_at DESC
        "#,
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows = match stmt.query_map([], |row| {
        Ok(ScanHistoryEntry {
            scan_path: row.get::<_, String>(0)?,
            scanned_at: row.get::<_, i64>(1)? as u64,
            total_files: row.get::<_, i64>(2)? as u64,
            total_dirs: row.get::<_, i64>(3)? as u64,
            total_size: row.get::<_, i64>(4)? as u64,
            cache_size_bytes: row.get::<_, i64>(5)? as u64,
        })
    }) {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    rows.filter_map(Result::ok).collect()
}

/// Log delete operation for trust UI
pub fn log_delete(scan_path: &str, target_path: &str, size_bytes: u64) -> Result<(), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_secs();

    let conn = open_db()?;
    conn.execute(
        r#"
        INSERT INTO delete_log (scan_path, target_path, size_bytes, deleted_at)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![scan_path, target_path, size_bytes as i64, now as i64],
    )
    .map_err(|e| format!("Failed to write delete log: {}", e))?;

    Ok(())
}

/// Read recent delete log entries
pub fn get_delete_log(scan_path: &str, limit: usize) -> Vec<DeleteLogEntry> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut stmt = match conn.prepare(
        r#"
        SELECT id, scan_path, target_path, size_bytes, deleted_at
        FROM delete_log
        WHERE scan_path = ?1
        ORDER BY deleted_at DESC
        LIMIT ?2
        "#,
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows = match stmt.query_map(params![scan_path, limit as i64], |row| {
        Ok(DeleteLogEntry {
            id: row.get::<_, i64>(0)? as u64,
            scan_path: row.get::<_, String>(1)?,
            target_path: row.get::<_, String>(2)?,
            size_bytes: row.get::<_, i64>(3)? as u64,
            deleted_at: row.get::<_, i64>(4)? as u64,
        })
    }) {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    rows.filter_map(Result::ok).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteLogEntry {
    pub id: u64,
    pub scan_path: String,
    pub target_path: String,
    pub size_bytes: u64,
    pub deleted_at: u64,
}
