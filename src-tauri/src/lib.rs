mod cache;
mod cleanable;
mod compare;
mod duplicates;
mod favorites;
mod scanner;
mod settings;
mod snapshot;

use cache::{CacheInfo, CachedScan, DeleteLogEntry, ScanHistoryEntry, SnapshotEntry};
use cleanable::{CleanableFinder, CleanableResult};
use compare::{CompareResult, DirectoryComparer};
use snapshot::SnapshotCompareResult;
use duplicates::{DuplicateFinder, DuplicateResult};
use favorites::Favorite;
use parking_lot::Mutex as ParkingLotMutex;
use scanner::{FileNode, Scanner, ScannerState};
use settings::Settings;
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::time::{sleep, Duration};

/// Record of a deleted file/folder for undo functionality
#[derive(Clone, serde::Serialize)]
pub struct DeletedItem {
    /// Original file/folder name
    pub name: String,
    /// Original absolute path
    pub original_path: String,
    /// Parent directory path
    pub parent_path: String,
    /// Whether it was a directory
    pub is_dir: bool,
    /// Deletion timestamp (Unix epoch seconds)
    pub deleted_at: u64,
}

/// Manages undo history for file deletions
pub struct UndoManager {
    /// Stack of deleted items (most recent first)
    history: ParkingLotMutex<VecDeque<DeletedItem>>,
    /// Maximum number of items to keep in history
    max_history: usize,
}

impl UndoManager {
    pub fn new(max_history: usize) -> Self {
        Self {
            history: ParkingLotMutex::new(VecDeque::new()),
            max_history,
        }
    }

    /// Record a deletion for potential undo
    pub fn record_deletion(&self, item: DeletedItem) {
        let mut history = self.history.lock();
        history.push_front(item);
        // Trim to max size
        while history.len() > self.max_history {
            history.pop_back();
        }
    }

    /// Get the most recent deleted item (for undo)
    pub fn get_last(&self) -> Option<DeletedItem> {
        let history = self.history.lock();
        history.front().cloned()
    }

    /// Remove the most recent item from history (after successful undo)
    pub fn pop_last(&self) -> Option<DeletedItem> {
        let mut history = self.history.lock();
        history.pop_front()
    }

    /// Get all items in history
    pub fn get_history(&self) -> Vec<DeletedItem> {
        let history = self.history.lock();
        history.iter().cloned().collect()
    }

    /// Clear all history
    pub fn clear(&self) {
        let mut history = self.history.lock();
        history.clear();
    }
}

/// Global scanner state
pub struct AppState {
    scanner_state: Arc<ScannerState>,
    duplicate_finder: Arc<DuplicateFinder>,
    directory_comparer: Arc<DirectoryComparer>,
    cleanable_finder: Arc<CleanableFinder>,
    undo_manager: Arc<UndoManager>,
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
            duplicate_finder: Arc::new(DuplicateFinder::new()),
            directory_comparer: Arc::new(DirectoryComparer::new()),
            cleanable_finder: Arc::new(CleanableFinder::new()),
            undo_manager: Arc::new(UndoManager::new(50)), // Keep last 50 deletions
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
    let scan_settings = settings::load_settings();

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
        let scan_settings = scan_settings.clone();
        let result = tokio::task::spawn_blocking(move || scanner.scan(&root_path, None, &scan_settings))
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
            let scan_settings = scan_settings.clone();
            let result = tokio::task::spawn_blocking(move || scanner.scan(&root_path, None, &scan_settings))
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
                let scan_settings = scan_settings.clone();
                if let Ok(Some(subtree)) = tokio::task::spawn_blocking(move || {
                    let scanner = Scanner::new(scanner_state);
                    scanner.scan(&dir_clone, None, &scan_settings)
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

    // Load settings for scanner configuration
    let scan_settings = settings::load_settings();

    let scanner = Scanner::new(state.scanner_state.clone());
    let path_for_cache = path.clone();
    let app_for_cache = app_handle.clone();

    // Run scanning in a blocking task to not block the async runtime
    let app_for_scan = app_handle.clone();
    let result = tokio::task::spawn_blocking(move || scanner.scan(&path_buf, Some(app_for_scan), &scan_settings))
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
/// Returns the deleted item info for undo functionality
#[tauri::command]
fn move_to_trash(path: String, state: State<'_, AppState>) -> Result<DeletedItem, String> {
    let path_buf = std::path::PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    // Gather info before deletion
    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let parent_path = path_buf
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let is_dir = path_buf.is_dir();
    let deleted_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Move to trash
    trash::delete(&path_buf).map_err(|e| format!("Failed to move to trash: {}", e))?;

    // Record for undo
    let deleted_item = DeletedItem {
        name,
        original_path: path,
        parent_path,
        is_dir,
        deleted_at,
    };

    state.undo_manager.record_deletion(deleted_item.clone());

    Ok(deleted_item)
}

/// Undo the last file deletion by restoring from trash using macOS Finder
#[tauri::command]
fn undo_delete(state: State<'_, AppState>) -> Result<DeletedItem, String> {
    let item = state
        .undo_manager
        .get_last()
        .ok_or_else(|| "No items to undo".to_string())?;

    #[cfg(target_os = "macos")]
    {
        // Use AppleScript to restore from Trash via Finder's "put back" command
        // This is the most reliable method on macOS
        let script = format!(
            r#"
            tell application "Finder"
                set trashPath to path to trash
                set targetName to "{}"
                set targetItems to (every item of trashPath whose name is targetName)
                if (count of targetItems) > 0 then
                    set targetItem to item 1 of targetItems
                    move targetItem to POSIX file "{}"
                    return "success"
                else
                    return "not found"
                end if
            end tell
            "#,
            item.name.replace('"', "\\\""),
            item.parent_path.replace('"', "\\\"")
        );

        let output = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if output.status.success() && stdout.contains("success") {
            // Successfully restored - remove from undo history
            state.undo_manager.pop_last();
            Ok(item)
        } else if stdout.contains("not found") {
            // Item not in trash (maybe already emptied)
            state.undo_manager.pop_last();
            Err("Item not found in trash - it may have been permanently deleted".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to restore: {} {}", stdout, stderr))
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Undo is only supported on macOS".to_string())
    }
}

/// Get the last deleted item info (for UI display)
#[tauri::command]
fn get_last_deleted(state: State<'_, AppState>) -> Option<DeletedItem> {
    state.undo_manager.get_last()
}

/// Get all deletion history
#[tauri::command]
fn get_deletion_history(state: State<'_, AppState>) -> Vec<DeletedItem> {
    state.undo_manager.get_history()
}

/// Clear deletion history
#[tauri::command]
fn clear_deletion_history(state: State<'_, AppState>) {
    state.undo_manager.clear();
}

/// Copy path to clipboard using pbcopy on macOS
#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let mut child = Command::new("pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn pbcopy: {}", e))?;

        if let Some(ref mut stdin) = child.stdin {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to pbcopy: {}", e))?;
        }

        child
            .wait()
            .map_err(|e| format!("Failed to wait for pbcopy: {}", e))?;
    }
    Ok(())
}

/// Open path in Terminal
#[tauri::command]
fn open_in_terminal(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let path_buf = std::path::PathBuf::from(&path);
        // If it's a file, open the parent directory
        let dir_path = if path_buf.is_file() {
            path_buf.parent().map(|p| p.to_path_buf()).unwrap_or(path_buf)
        } else {
            path_buf
        };

        std::process::Command::new("open")
            .args(["-a", "Terminal", dir_path.to_str().unwrap_or("")])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Preview file using Quick Look (macOS)
#[tauri::command]
fn preview_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let path_buf = std::path::PathBuf::from(&path);
        if !path_buf.exists() {
            return Err(format!("Path does not exist: {}", path));
        }

        // Use qlmanage for Quick Look preview
        std::process::Command::new("qlmanage")
            .args(["-p", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Quick Look: {}", e))?;
    }
    Ok(())
}

/// File information struct
#[derive(serde::Serialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub created_at: Option<u64>,     // Unix timestamp
    pub modified_at: Option<u64>,    // Unix timestamp
    pub accessed_at: Option<u64>,    // Unix timestamp
    pub permissions: Option<String>, // Unix permissions string (e.g., "rwxr-xr-x")
    pub owner: Option<String>,
    pub group: Option<String>,
    pub file_count: Option<u64>,     // For directories
    pub extension: Option<String>,
    pub kind: String,                // File kind description
}

/// Get detailed file information
#[tauri::command]
fn get_file_info(path: String) -> Result<FileInfo, String> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to get metadata: {}", e))?;
    let symlink_metadata = fs::symlink_metadata(&path).ok();
    let is_symlink = symlink_metadata.map(|m| m.file_type().is_symlink()).unwrap_or(false);

    let name = path_obj
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let extension = path_obj
        .extension()
        .map(|e| e.to_string_lossy().to_string());

    // Get timestamps
    let created_at = metadata.created().ok().and_then(|t| {
        t.duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs())
    });
    let modified_at = metadata.modified().ok().and_then(|t| {
        t.duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs())
    });
    let accessed_at = metadata.accessed().ok().and_then(|t| {
        t.duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs())
    });

    // Get Unix permissions as string
    let mode = metadata.permissions().mode();
    let permissions = Some(format_permissions(mode));

    // Get owner and group
    let (owner, group) = get_owner_group(&metadata);

    // Count files in directory
    let file_count = if metadata.is_dir() {
        fs::read_dir(&path).ok().map(|entries| entries.count() as u64)
    } else {
        None
    };

    // Determine file kind
    let kind = if metadata.is_dir() {
        "Folder".to_string()
    } else if is_symlink {
        "Symbolic Link".to_string()
    } else {
        get_file_kind(&extension)
    };

    Ok(FileInfo {
        path,
        name,
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_symlink,
        created_at,
        modified_at,
        accessed_at,
        permissions,
        owner,
        group,
        file_count,
        extension,
        kind,
    })
}

/// Format Unix permissions to string like "rwxr-xr-x"
fn format_permissions(mode: u32) -> String {
    let mut result = String::with_capacity(9);

    // Owner permissions
    result.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o100 != 0 { 'x' } else { '-' });

    // Group permissions
    result.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o010 != 0 { 'x' } else { '-' });

    // Others permissions
    result.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    result.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    result.push(if mode & 0o001 != 0 { 'x' } else { '-' });

    result
}

/// Get owner and group names from metadata
fn get_owner_group(metadata: &std::fs::Metadata) -> (Option<String>, Option<String>) {
    use std::os::unix::fs::MetadataExt;

    #[cfg(target_os = "macos")]
    {
        let uid = metadata.uid();
        let gid = metadata.gid();

        // Get username from uid
        let owner = std::process::Command::new("id")
            .args(["-un", &uid.to_string()])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            });

        // Get group name from gid
        let group = std::process::Command::new("id")
            .args(["-gn", &gid.to_string()])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            });

        (owner, group)
    }

    #[cfg(not(target_os = "macos"))]
    {
        (None, None)
    }
}

/// File preview data
#[derive(serde::Serialize)]
#[serde(tag = "type")]
pub enum FilePreview {
    #[serde(rename = "image")]
    Image {
        data: String,        // Base64 encoded image data
        mime_type: String,   // e.g., "image/png"
        width: Option<u32>,
        height: Option<u32>,
    },
    #[serde(rename = "text")]
    Text {
        content: String,     // Text content (first N lines)
        lines: usize,        // Number of lines included
        total_lines: usize,  // Total lines in file
        extension: Option<String>,
    },
    #[serde(rename = "video")]
    Video {
        thumbnail: Option<String>,  // Base64 encoded thumbnail
        duration: Option<String>,   // Duration string
        resolution: Option<String>, // e.g., "1920x1080"
    },
    #[serde(rename = "audio")]
    Audio {
        duration: Option<String>,
        bitrate: Option<String>,
        sample_rate: Option<String>,
    },
    #[serde(rename = "unsupported")]
    Unsupported {
        kind: String,
        extension: Option<String>,
    },
}

/// Get file preview data
#[tauri::command]
fn get_file_preview(path: String) -> Result<FilePreview, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::fs;
    use std::io::{BufRead, BufReader};
    use std::path::Path;

    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if file_path.is_dir() {
        return Err("Cannot preview a directory".to_string());
    }

    let extension = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase());

    // Determine file type based on extension
    match extension.as_deref() {
        // Images
        Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("bmp")
        | Some("ico") | Some("svg") => {
            let data = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;

            // Limit preview size to 5MB to prevent memory issues
            if data.len() > 5 * 1024 * 1024 {
                return Ok(FilePreview::Unsupported {
                    kind: "Large Image".to_string(),
                    extension: extension.clone(),
                });
            }

            let mime_type = match extension.as_deref() {
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("gif") => "image/gif",
                Some("webp") => "image/webp",
                Some("bmp") => "image/bmp",
                Some("ico") => "image/x-icon",
                Some("svg") => "image/svg+xml",
                _ => "image/unknown",
            };

            // Try to get image dimensions (basic implementation)
            let (width, height) = get_image_dimensions(&data, extension.as_deref());

            Ok(FilePreview::Image {
                data: STANDARD.encode(&data),
                mime_type: mime_type.to_string(),
                width,
                height,
            })
        }

        // Text files
        Some("txt") | Some("md") | Some("json") | Some("xml") | Some("yaml") | Some("yml")
        | Some("toml") | Some("ini") | Some("cfg") | Some("conf") | Some("log") | Some("sh")
        | Some("bash") | Some("zsh") | Some("fish") | Some("py") | Some("js") | Some("ts")
        | Some("jsx") | Some("tsx") | Some("html") | Some("css") | Some("scss") | Some("less")
        | Some("rs") | Some("go") | Some("java") | Some("c") | Some("cpp") | Some("h")
        | Some("hpp") | Some("swift") | Some("kt") | Some("rb") | Some("php") | Some("sql")
        | Some("graphql") | Some("vue") | Some("svelte") | Some("env") | Some("gitignore")
        | Some("dockerfile") | Some("makefile") => {
            let file = fs::File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
            let reader = BufReader::new(file);

            let max_lines = 100;
            let max_chars = 10000;
            let mut lines: Vec<String> = Vec::new();
            let mut total_chars = 0;
            let mut total_lines = 0;

            for line_result in reader.lines() {
                total_lines += 1;
                if lines.len() < max_lines && total_chars < max_chars {
                    if let Ok(line) = line_result {
                        total_chars += line.len();
                        lines.push(line);
                    }
                }
            }

            Ok(FilePreview::Text {
                content: lines.join("\n"),
                lines: lines.len(),
                total_lines,
                extension: extension.clone(),
            })
        }

        // Video files - try to get metadata
        Some("mp4") | Some("mov") | Some("avi") | Some("mkv") | Some("webm") | Some("m4v")
        | Some("wmv") | Some("flv") => {
            // Try to extract video thumbnail using ffmpeg if available
            let thumbnail = extract_video_thumbnail(&path);

            Ok(FilePreview::Video {
                thumbnail,
                duration: None,
                resolution: None,
            })
        }

        // Audio files
        Some("mp3") | Some("wav") | Some("aac") | Some("flac") | Some("ogg") | Some("m4a")
        | Some("wma") | Some("aiff") => Ok(FilePreview::Audio {
            duration: None,
            bitrate: None,
            sample_rate: None,
        }),

        // Unsupported
        _ => Ok(FilePreview::Unsupported {
            kind: get_file_kind(&extension),
            extension,
        }),
    }
}

/// Try to get image dimensions from raw bytes (basic PNG/JPEG support)
fn get_image_dimensions(data: &[u8], ext: Option<&str>) -> (Option<u32>, Option<u32>) {
    match ext {
        Some("png") if data.len() >= 24 => {
            // PNG: width at bytes 16-19, height at bytes 20-23
            let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
            let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
            (Some(width), Some(height))
        }
        Some("jpg") | Some("jpeg") => {
            // JPEG: need to parse SOF marker - this is complex, skip for now
            (None, None)
        }
        _ => (None, None),
    }
}

/// Try to extract video thumbnail using ffmpeg
fn extract_video_thumbnail(path: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::process::Command;

    // Create a temp file for the thumbnail
    let temp_path = format!("/tmp/spaceview_thumb_{}.jpg", std::process::id());

    // Try to use ffmpeg to extract a frame
    let result = Command::new("ffmpeg")
        .args([
            "-i",
            path,
            "-ss",
            "00:00:01",
            "-vframes",
            "1",
            "-vf",
            "scale=320:-1",
            "-y",
            &temp_path,
        ])
        .output();

    if let Ok(output) = result {
        if output.status.success() {
            if let Ok(data) = std::fs::read(&temp_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Some(STANDARD.encode(&data));
            }
        }
    }

    let _ = std::fs::remove_file(&temp_path);
    None
}

/// Get file kind description based on extension
fn get_file_kind(extension: &Option<String>) -> String {
    match extension.as_ref().map(|e| e.to_lowercase()).as_deref() {
        // Code
        Some("swift") => "Swift Source",
        Some("js") => "JavaScript",
        Some("ts") => "TypeScript",
        Some("jsx") => "React JSX",
        Some("tsx") => "React TSX",
        Some("py") => "Python Script",
        Some("rs") => "Rust Source",
        Some("go") => "Go Source",
        Some("java") => "Java Source",
        Some("c") => "C Source",
        Some("cpp") | Some("cc") => "C++ Source",
        Some("h") => "C Header",
        Some("hpp") => "C++ Header",
        Some("html") => "HTML Document",
        Some("css") => "CSS Stylesheet",
        Some("json") => "JSON Document",
        Some("xml") => "XML Document",
        Some("yaml") | Some("yml") => "YAML Document",
        Some("md") => "Markdown Document",
        Some("sh") | Some("bash") | Some("zsh") => "Shell Script",
        // Images
        Some("png") => "PNG Image",
        Some("jpg") | Some("jpeg") => "JPEG Image",
        Some("gif") => "GIF Image",
        Some("svg") => "SVG Image",
        Some("webp") => "WebP Image",
        Some("heic") => "HEIC Image",
        Some("psd") => "Photoshop Document",
        // Videos
        Some("mp4") => "MPEG-4 Video",
        Some("mov") => "QuickTime Movie",
        Some("avi") => "AVI Video",
        Some("mkv") => "Matroska Video",
        Some("webm") => "WebM Video",
        // Audio
        Some("mp3") => "MP3 Audio",
        Some("wav") => "WAV Audio",
        Some("flac") => "FLAC Audio",
        Some("aac") => "AAC Audio",
        Some("m4a") => "MPEG-4 Audio",
        // Documents
        Some("pdf") => "PDF Document",
        Some("doc") | Some("docx") => "Word Document",
        Some("xls") | Some("xlsx") => "Excel Spreadsheet",
        Some("ppt") | Some("pptx") => "PowerPoint",
        Some("txt") => "Plain Text",
        Some("rtf") => "Rich Text",
        // Archives
        Some("zip") => "ZIP Archive",
        Some("tar") => "TAR Archive",
        Some("gz") => "Gzip Archive",
        Some("rar") => "RAR Archive",
        Some("7z") => "7-Zip Archive",
        Some("dmg") => "Disk Image",
        // Other
        Some("app") => "Application",
        Some("pkg") => "Installer Package",
        Some(ext) => return format!("{} File", ext.to_uppercase()),
        None => "Document",
    }
    .to_string()
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

/// Find duplicate files in a directory
#[tauri::command]
async fn find_duplicates(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    path: String,
    min_size: Option<u64>,
) -> Result<Option<DuplicateResult>, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !path_buf.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let finder = state.duplicate_finder.clone();

    tokio::task::spawn_blocking(move || {
        finder.find_duplicates(&path_buf, min_size, &app_handle)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Cancel ongoing duplicate scan
#[tauri::command]
fn cancel_duplicate_scan(state: State<'_, AppState>) {
    state.duplicate_finder.cancel();
}

/// Get all favorites
#[tauri::command]
fn get_favorites() -> Vec<Favorite> {
    favorites::get_favorites()
}

/// Add a path to favorites
#[tauri::command]
fn add_favorite(path: String) -> Result<Favorite, String> {
    favorites::add_favorite(&path)
}

/// Remove a path from favorites
#[tauri::command]
fn remove_favorite(path: String) -> Result<(), String> {
    favorites::remove_favorite(&path)
}

/// Check if a path is favorited
#[tauri::command]
fn is_favorite(path: String) -> bool {
    favorites::is_favorite(&path)
}

/// Clear all favorites
#[tauri::command]
fn clear_favorites() -> Result<usize, String> {
    favorites::clear_favorites()
}

/// Compare two directories
#[tauri::command]
async fn compare_directories(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    left_path: String,
    right_path: String,
) -> Result<Option<CompareResult>, String> {
    let left = PathBuf::from(&left_path);
    let right = PathBuf::from(&right_path);

    if !left.exists() {
        return Err(format!("Left path does not exist: {}", left_path));
    }

    if !right.exists() {
        return Err(format!("Right path does not exist: {}", right_path));
    }

    if !left.is_dir() {
        return Err(format!("Left path is not a directory: {}", left_path));
    }

    if !right.is_dir() {
        return Err(format!("Right path is not a directory: {}", right_path));
    }

    let comparer = state.directory_comparer.clone();

    tokio::task::spawn_blocking(move || {
        comparer.compare_directories(&left, &right, &app_handle)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Cancel ongoing directory comparison
#[tauri::command]
fn cancel_compare(state: State<'_, AppState>) {
    state.directory_comparer.cancel();
}

// ============================================================================
// Cleanable Files Commands
// ============================================================================

/// Find cleanable files and directories in a path
#[tauri::command]
async fn find_cleanable(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<CleanableResult>, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !path_buf.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let finder = state.cleanable_finder.clone();

    tokio::task::spawn_blocking(move || finder.find_cleanable(&path_buf, &app_handle))
        .await
        .map_err(|e| e.to_string())
}

/// Cancel ongoing cleanable scan
#[tauri::command]
fn cancel_cleanable_scan(state: State<'_, AppState>) {
    state.cleanable_finder.cancel();
}

// ============================================================================
// Settings Commands
// ============================================================================

/// Get current settings
#[tauri::command]
fn get_settings() -> Settings {
    settings::load_settings()
}

/// Save settings
#[tauri::command]
fn save_settings(new_settings: Settings) -> Result<(), String> {
    settings::save_settings(&new_settings)
}

/// Reset settings to defaults
#[tauri::command]
fn reset_settings() -> Result<Settings, String> {
    settings::reset_settings()
}

/// Add an ignore pattern
#[tauri::command]
fn add_ignore_pattern(pattern: String) -> Result<Settings, String> {
    settings::add_ignore_pattern(&pattern)
}

/// Remove an ignore pattern
#[tauri::command]
fn remove_ignore_pattern(pattern: String) -> Result<Settings, String> {
    settings::remove_ignore_pattern(&pattern)
}

/// Export settings as JSON string for backup
#[tauri::command]
fn export_settings() -> Result<String, String> {
    let settings = settings::load_settings();
    serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))
}

/// Import settings from JSON string
#[tauri::command]
fn import_settings(json: String) -> Result<Settings, String> {
    let imported: Settings = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse settings JSON: {}", e))?;
    settings::save_settings(&imported)?;
    Ok(imported)
}

// ============================================================================
// Snapshot Commands (for scan result comparison over time)
// ============================================================================

/// Save current scan as a snapshot for future comparison
#[tauri::command]
async fn save_snapshot(
    app_handle: AppHandle,
    path: String,
) -> Result<String, String> {
    // First, load the current cached scan
    let cached = cache::load_from_cache(&path)
        .map_err(|_| "No cached scan found for this path. Please scan the directory first.")?;

    // Save as a snapshot
    let snapshot_path = cache::save_snapshot(&path, &cached.root)?;

    // Emit event
    let _ = app_handle.emit("snapshot-saved", snapshot_path.to_string_lossy().to_string());

    Ok(snapshot_path.to_string_lossy().to_string())
}

/// List all snapshots for a path
#[tauri::command]
fn list_snapshots(path: String) -> Vec<SnapshotEntry> {
    cache::list_snapshots(&path)
}

/// Delete a specific snapshot
#[tauri::command]
fn delete_snapshot_cmd(path: String, timestamp: u64) -> Result<(), String> {
    cache::delete_snapshot(&path, timestamp)
}

/// Delete all snapshots for a path
#[tauri::command]
fn delete_all_snapshots_cmd(path: String) -> Result<usize, String> {
    cache::delete_all_snapshots(&path)
}

/// Compare two snapshots of the same path
#[tauri::command]
async fn compare_snapshots(
    path: String,
    old_timestamp: u64,
    new_timestamp: u64,
) -> Result<SnapshotCompareResult, String> {
    // Load both snapshots
    let old_scan = cache::load_snapshot(&path, old_timestamp)?;
    let new_scan = cache::load_snapshot(&path, new_timestamp)?;

    // Compare them
    let result = snapshot::compare_snapshots(
        &old_scan.root,
        &new_scan.root,
        &path,
        old_timestamp,
        new_timestamp,
    );

    Ok(result)
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
            undo_delete,
            get_last_deleted,
            get_deletion_history,
            clear_deletion_history,
            copy_to_clipboard,
            open_in_terminal,
            preview_file,
            get_file_preview,
            get_file_info,
            get_disks,
            get_disk_info,
            check_cache,
            delete_cache,
            clear_all_caches,
            get_scan_history,
            get_delete_log,
            refresh_incremental,
            find_duplicates,
            cancel_duplicate_scan,
            get_favorites,
            add_favorite,
            remove_favorite,
            is_favorite,
            clear_favorites,
            compare_directories,
            cancel_compare,
            find_cleanable,
            cancel_cleanable_scan,
            get_settings,
            save_settings,
            reset_settings,
            add_ignore_pattern,
            remove_ignore_pattern,
            export_settings,
            import_settings,
            save_snapshot,
            list_snapshots,
            delete_snapshot_cmd,
            delete_all_snapshots_cmd,
            compare_snapshots,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
