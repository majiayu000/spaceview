mod cache;
mod scanner;

use cache::{CacheInfo, CachedScan, DeleteLogEntry, ScanHistoryEntry};
use scanner::{FileNode, Scanner, ScannerState};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::time::{sleep, Duration};

/// Global scanner state
pub struct AppState {
    scanner_state: Arc<ScannerState>,
    current_tree: Arc<Mutex<Option<FileNode>>>,
    current_scan_path: Arc<Mutex<Option<String>>>,
    watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    dirty_paths: Arc<Mutex<HashSet<PathBuf>>>,
    incremental_scheduled: Arc<AtomicBool>,
    scan_in_progress: Arc<AtomicBool>,
}

#[derive(Clone, serde::Serialize)]
struct WatcherStatus {
    active: bool,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct IncrementalStatus {
    phase: String, // "start" | "complete"
    updated: bool,
    full_rescan: bool,
    dirty_count: usize,
    at: u64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            scanner_state: Arc::new(ScannerState::new()),
            current_tree: Arc::new(Mutex::new(None)),
            current_scan_path: Arc::new(Mutex::new(None)),
            watcher: Arc::new(Mutex::new(None)),
            dirty_paths: Arc::new(Mutex::new(HashSet::new())),
            incremental_scheduled: Arc::new(AtomicBool::new(false)),
            scan_in_progress: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn start_watching(app: &AppHandle, state: &AppState, scan_path: &str) {
    let mut watcher_guard = state.watcher.lock().unwrap();
    // Reset watcher if scan path changed
    *watcher_guard = None;
    state.incremental_scheduled.store(false, Ordering::Relaxed);

    let dirty_paths = state.dirty_paths.clone();
    let incremental_scheduled = state.incremental_scheduled.clone();
    let scan_path_buf = PathBuf::from(scan_path);
    let app_handle = app.clone();

    let watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let mut dirty = dirty_paths.lock().unwrap();
                for path in event.paths {
                    dirty.insert(path);
                }

                if !incremental_scheduled.swap(true, Ordering::Relaxed) {
                    let app_handle = app_handle.clone();
                    let scheduled = incremental_scheduled.clone();
                    tauri::async_runtime::spawn(async move {
                        // Debounce multiple file events
                        sleep(Duration::from_millis(800)).await;
                        scheduled.store(false, Ordering::Relaxed);
                        let _ = perform_incremental_refresh(app_handle).await;
                    });
                }
            }
        },
        Config::default(),
    );

    match watcher {
        Ok(mut watcher) => {
            if watcher
                .watch(&scan_path_buf, RecursiveMode::Recursive)
                .is_ok()
            {
                *watcher_guard = Some(watcher);
                let _ = app.emit(
                    "watcher-status",
                    WatcherStatus {
                        active: true,
                        path: scan_path.to_string(),
                        error: None,
                    },
                );
            } else {
                let _ = app.emit(
                    "watcher-status",
                    WatcherStatus {
                        active: false,
                        path: scan_path.to_string(),
                        error: Some("Failed to watch path".to_string()),
                    },
                );
            }
        }
        Err(e) => {
            eprintln!("[Watch] Failed to init watcher: {}", e);
            let _ = app.emit(
                "watcher-status",
                WatcherStatus {
                    active: false,
                    path: scan_path.to_string(),
                    error: Some(e.to_string()),
                },
            );
        }
    }
}

fn coalesce_dirty_dirs(dirty_paths: HashSet<PathBuf>, scan_root: &PathBuf) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    for path in dirty_paths {
        if !path.starts_with(scan_root) {
            continue;
        }

        let use_path = match fs::metadata(&path) {
            Ok(meta) => {
                if meta.is_dir() {
                    path
                } else {
                    path.parent().map(|p| p.to_path_buf()).unwrap_or(path)
                }
            }
            Err(_) => {
                // If removed, rescan parent directory
                path.parent().map(|p| p.to_path_buf()).unwrap_or(path)
            }
        };

        dirs.push(use_path);
    }

    dirs.sort();
    dirs.dedup();

    // Remove paths that are descendants of other dirty paths
    let mut filtered: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if !filtered.iter().any(|p| dir.starts_with(p)) {
            filtered.push(dir);
        }
    }

    filtered
}

fn recompute_dir_stats(node: &FileNode) -> (u64, u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    let mut dirs = 0u64;

    for child in &node.children {
        size += child.size;
        if child.is_dir {
            files += child.file_count;
            dirs += 1 + child.dir_count;
        } else {
            files += 1;
        }
    }

    (size, files, dirs)
}

fn node_exists(root: &FileNode, target_path: &str) -> bool {
    if root.path == target_path {
        return true;
    }
    if !root.is_dir {
        return false;
    }
    for child in &root.children {
        if node_exists(child, target_path) {
            return true;
        }
    }
    false
}

fn replace_subtree(mut root: FileNode, target_path: &str, new_subtree: &FileNode) -> FileNode {
    if root.path == target_path {
        return new_subtree.clone();
    }

    if !root.is_dir {
        return root;
    }

    let mut changed = false;
    let mut children = Vec::with_capacity(root.children.len());

    for child in root.children.iter().cloned() {
        if child.path == target_path {
            children.push(new_subtree.clone());
            changed = true;
            continue;
        }

        if target_path.starts_with(&format!("{}/", child.path)) {
            let updated = replace_subtree(child, target_path, new_subtree);
            children.push(updated);
            changed = true;
        } else {
            children.push(child);
        }
    }

    if !changed {
        return root;
    }

    root.children = children;
    let (size, files, dirs) = recompute_dir_stats(&root);
    root.size = size;
    root.file_count = files;
    root.dir_count = dirs;
    root
}

async fn perform_incremental_refresh(app_handle: AppHandle) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    if state.scan_in_progress.swap(true, Ordering::Relaxed) {
        return Ok(());
    }

    let scan_path = {
        let path_guard = state.current_scan_path.lock().unwrap();
        path_guard.clone()
    };

    let scan_path = match scan_path {
        Some(p) => p,
        None => {
            state.scan_in_progress.store(false, Ordering::Relaxed);
            return Ok(());
        }
    };

    let root_path = PathBuf::from(&scan_path);

    let dirty_paths = {
        let mut guard = state.dirty_paths.lock().unwrap();
        std::mem::take(&mut *guard)
    };

    if dirty_paths.is_empty() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let _ = app_handle.emit(
            "incremental-status",
            IncrementalStatus {
                phase: "complete".to_string(),
                updated: false,
                full_rescan: false,
                dirty_count: 0,
                at: now,
            },
        );
        state.scan_in_progress.store(false, Ordering::Relaxed);
        return Ok(());
    }

    let dirty_dirs = coalesce_dirty_dirs(dirty_paths, &root_path);
    let dirty_count = dirty_dirs.len();
    let full_rescan = dirty_dirs.len() > 40 || dirty_dirs.iter().any(|p| p == &root_path);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let _ = app_handle.emit(
        "incremental-status",
        IncrementalStatus {
            phase: "start".to_string(),
            updated: false,
            full_rescan,
            dirty_count,
            at: now,
        },
    );

    let mut updated_root = {
        let tree_guard = state.current_tree.lock().unwrap();
        tree_guard.clone()
    };

    if updated_root.is_none() || full_rescan {
        let scanner = Scanner::new(state.scanner_state.clone());
        let result = tokio::task::spawn_blocking(move || scanner.scan(&root_path, None))
            .await
            .map_err(|e| e.to_string())?;
        if let Some(root) = result {
            updated_root = Some(root);
        }
    } else if let Some(root) = updated_root.take() {
        let mut next_root = root;
        let mut effective_dirs: Vec<PathBuf> = Vec::new();
        for dir in dirty_dirs.iter() {
            let target = dir.to_string_lossy().to_string();
            if node_exists(&next_root, &target) {
                effective_dirs.push(dir.clone());
            } else if let Some(parent) = dir.parent() {
                effective_dirs.push(parent.to_path_buf());
            } else {
                effective_dirs.push(root_path.clone());
            }
        }

        effective_dirs.sort();
        effective_dirs.dedup();

        if effective_dirs.iter().any(|p| p == &root_path) {
            let scanner = Scanner::new(state.scanner_state.clone());
            let result = tokio::task::spawn_blocking(move || scanner.scan(&root_path, None))
                .await
                .map_err(|e| e.to_string())?;
            if let Some(root) = result {
                updated_root = Some(root);
            }
        } else {
            let scanner_state = state.scanner_state.clone();
            for dir in effective_dirs {
                if dir == root_path {
                    continue;
                }
                let dir_clone = dir.clone();
                let scanner_state = scanner_state.clone();
                if let Ok(Some(subtree)) = tokio::task::spawn_blocking(move || {
                    let scanner = Scanner::new(scanner_state);
                    scanner.scan(&dir_clone, None)
                })
                .await
                .map_err(|e| e.to_string())
                {
                    let target = dir.to_string_lossy().to_string();
                    next_root = replace_subtree(next_root, &target, &subtree);
                }
            }
            updated_root = Some(next_root);
        }
    }

    let result = if let Some(root) = updated_root {
        {
            let mut tree = state.current_tree.lock().unwrap();
            *tree = Some(root.clone());
        }
        cache::save_incremental_update(&scan_path, &root)?;
        let _ = app_handle.emit("scan-incremental", &root);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let _ = app_handle.emit(
            "incremental-status",
            IncrementalStatus {
                phase: "complete".to_string(),
                updated: true,
                full_rescan,
                dirty_count,
                at: now,
            },
        );
        Ok(())
    } else {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let _ = app_handle.emit(
            "incremental-status",
            IncrementalStatus {
                phase: "complete".to_string(),
                updated: false,
                full_rescan,
                dirty_count,
                at: now,
            },
        );
        Ok(())
    };

    state.scan_in_progress.store(false, Ordering::Relaxed);
    result
}

/// Scan a specific directory (with optional caching)
#[tauri::command]
async fn scan_directory(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    path: String,
    use_cache: Option<bool>,
) -> Result<Option<FileNode>, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !path_buf.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    if state.scan_in_progress.swap(true, Ordering::Relaxed) {
        return Err("Scan already in progress".to_string());
    }

    // Try to load from cache first if use_cache is true (default)
    let should_use_cache = use_cache.unwrap_or(true);
    if should_use_cache {
        if let Ok(cached) = cache::load_from_cache(&path) {
            println!("[Scan] Using cached result for {}", path);
            // Emit cache-loaded event
            let _ = app_handle.emit("scan-from-cache", &cached);
            {
                let mut tree = state.current_tree.lock().unwrap();
                *tree = Some(cached.root.clone());
            }
            {
                let mut scan_path = state.current_scan_path.lock().unwrap();
                *scan_path = Some(path.clone());
            }
            {
                let mut dirty = state.dirty_paths.lock().unwrap();
                dirty.clear();
            }
            state.scan_in_progress.store(false, Ordering::Relaxed);
            start_watching(&app_handle, &state, &path);
            return Ok(Some(cached.root));
        }
    }

    let scanner = Scanner::new(state.scanner_state.clone());
    let path_for_cache = path.clone();
    let app_for_cache = app_handle.clone();

    // Run scanning in a blocking task to not block the async runtime
    let app_for_scan = app_handle.clone();
    let result = tokio::task::spawn_blocking(move || scanner.scan(&path_buf, Some(&app_for_scan)))
        .await
        .map_err(|e| e.to_string());

    // Save to cache after successful scan
    if let Ok(Some(ref root)) = result {
        {
            let mut tree = state.current_tree.lock().unwrap();
            *tree = Some(root.clone());
        }
        {
            let mut scan_path = state.current_scan_path.lock().unwrap();
            *scan_path = Some(path.clone());
        }
        {
            let mut dirty = state.dirty_paths.lock().unwrap();
            dirty.clear();
        }
        let root_clone = root.clone();
        tokio::task::spawn_blocking(move || {
            match cache::save_to_cache(&path_for_cache, &root_clone) {
                Ok(cache_path) => {
                    let _ = app_for_cache.emit("cache-saved", cache_path.to_string_lossy().to_string());
                }
                Err(e) => {
                    eprintln!("[Cache] Failed to save: {}", e);
                }
            }
        });
        start_watching(&app_handle, &state, &path);
    }

    state.scan_in_progress.store(false, Ordering::Relaxed);
    result
}

/// Check if cache exists for a path
#[tauri::command]
fn check_cache(path: String) -> Option<CacheInfo> {
    cache::get_cache_info(&path)
}

/// Load scan results from cache only (don't scan)
#[tauri::command]
async fn load_from_cache(path: String) -> Result<CachedScan, String> {
    tokio::task::spawn_blocking(move || cache::load_from_cache(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Delete cache for a specific path
#[tauri::command]
fn delete_cache(path: String) -> Result<(), String> {
    cache::delete_cache(&path)
}

/// Clear all caches
#[tauri::command]
fn clear_all_caches() -> Result<usize, String> {
    cache::clear_all_caches()
}

/// Get scan history (all cached scans)
#[tauri::command]
fn get_scan_history() -> Vec<ScanHistoryEntry> {
    cache::get_scan_history()
}

/// Get delete log entries for a scan path
#[tauri::command]
fn get_delete_log(scan_path: String, limit: Option<u32>) -> Vec<DeleteLogEntry> {
    cache::get_delete_log(&scan_path, limit.unwrap_or(20) as usize)
}

/// Trigger an incremental refresh (best-effort)
#[tauri::command]
async fn refresh_incremental(app_handle: AppHandle) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    if let Some(scan_path) = state.current_scan_path.lock().unwrap().clone() {
        let mut dirty = state.dirty_paths.lock().unwrap();
        dirty.insert(PathBuf::from(scan_path));
    }
    perform_incremental_refresh(app_handle).await
}

/// Open folder picker dialog - returns the selected path
#[tauri::command]
async fn open_folder_dialog(app_handle: AppHandle) -> Result<Option<String>, String> {
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();

    app_handle
        .dialog()
        .file()
        .set_title("Select folder to analyze")
        .pick_folder(move |folder_path| {
            let path = folder_path.map(|p| p.to_string());
            let _ = tx.send(path);
        });

    rx.await.map_err(|e| e.to_string())
}

/// Cancel ongoing scan
#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    state.scanner_state.cancel();
}

/// Open path in Finder
#[tauri::command]
fn show_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open file with default application
#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Move file to trash (using safe trash crate, no shell injection risk)
#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    trash::delete(&path_buf).map_err(|e| format!("Failed to move to trash: {}", e))
}

/// Move file to trash and log the delete (optional)
#[tauri::command]
fn move_to_trash_logged(
    path: String,
    scan_path: Option<String>,
    size_bytes: Option<u64>,
) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    trash::delete(&path_buf).map_err(|e| format!("Failed to move to trash: {}", e))?;

    if let (Some(scan_path), Some(size_bytes)) = (scan_path, size_bytes) {
        let _ = cache::log_delete(&scan_path, &path, size_bytes);
    }

    Ok(())
}

/// Get disk list
#[tauri::command]
fn get_disks() -> Vec<DiskInfo> {
    #[cfg(target_os = "macos")]
    {
        // Get mounted volumes
        let output = std::process::Command::new("df")
            .args(["-h"])
            .output()
            .ok();

        if let Some(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut disks = Vec::new();

            for line in stdout.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 9 {
                    let mount_point = parts[8..].join(" ");
                    if mount_point.starts_with("/Volumes/") || mount_point == "/" {
                        disks.push(DiskInfo {
                            name: if mount_point == "/" {
                                "Macintosh HD".to_string()
                            } else {
                                mount_point.replace("/Volumes/", "")
                            },
                            path: mount_point,
                            total: parts[1].to_string(),
                            used: parts[2].to_string(),
                            available: parts[3].to_string(),
                        });
                    }
                }
            }

            return disks;
        }
    }

    Vec::new()
}

#[derive(serde::Serialize)]
pub struct DiskInfo {
    name: String,
    path: String,
    total: String,
    used: String,
    available: String,
}

/// Disk space info with bytes for accurate calculation
#[derive(serde::Serialize)]
pub struct DiskSpaceInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub mount_point: String,
}

/// Get disk space info for a specific path
#[tauri::command]
fn get_disk_info(path: String) -> Result<DiskSpaceInfo, String> {
    use std::path::Path;

    let path = Path::new(&path);
    if !path.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Use df command to get disk info in bytes
        let output = Command::new("df")
            .args(["-k", path.to_str().unwrap_or("")])
            .output()
            .map_err(|e| e.to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().collect();

        if lines.len() < 2 {
            return Err("Failed to get disk info".to_string());
        }

        let parts: Vec<&str> = lines[1].split_whitespace().collect();
        if parts.len() < 6 {
            return Err("Failed to parse disk info".to_string());
        }

        // df -k outputs in 1K blocks
        let total_kb: u64 = parts[1].parse().unwrap_or(0);
        let used_kb: u64 = parts[2].parse().unwrap_or(0);
        let available_kb: u64 = parts[3].parse().unwrap_or(0);
        let mount_point = parts[5..].join(" ");

        Ok(DiskSpaceInfo {
            total_bytes: total_kb * 1024,
            used_bytes: used_kb * 1024,
            available_bytes: available_kb * 1024,
            mount_point,
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Disk info not supported on this platform".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            scan_directory,
            load_from_cache,
            cancel_scan,
            show_in_finder,
            open_file,
            move_to_trash,
            move_to_trash_logged,
            get_disks,
            get_disk_info,
            check_cache,
            delete_cache,
            clear_all_caches,
            get_scan_history,
            get_delete_log,
            refresh_incremental,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
