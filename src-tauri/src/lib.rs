mod cache;
mod duplicates;
mod scanner;

use cache::{CacheInfo, CachedScan, ScanHistoryEntry};
use duplicates::{DuplicateFinder, DuplicateResult};
use scanner::{FileNode, Scanner, ScannerState};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

/// Global scanner state
pub struct AppState {
    scanner_state: Arc<ScannerState>,
    duplicate_finder: Arc<DuplicateFinder>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            scanner_state: Arc::new(ScannerState::new()),
            duplicate_finder: Arc::new(DuplicateFinder::new()),
        }
    }
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

    // Try to load from cache first if use_cache is true (default)
    let should_use_cache = use_cache.unwrap_or(true);
    if should_use_cache {
        if let Ok(cached) = cache::load_from_cache(&path) {
            println!("[Scan] Using cached result for {}", path);
            // Emit cache-loaded event
            let _ = app_handle.emit("scan-from-cache", &cached);
            return Ok(Some(cached.root));
        }
    }

    let scanner = Scanner::new(state.scanner_state.clone());
    let path_for_cache = path.clone();
    let app_for_cache = app_handle.clone();

    // Run scanning in a blocking task to not block the async runtime
    let result = tokio::task::spawn_blocking(move || scanner.scan(&path_buf, &app_handle))
        .await
        .map_err(|e| e.to_string())?;

    // Save to cache after successful scan
    if let Some(ref root) = result {
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
    }

    Ok(result)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            scan_directory,
            cancel_scan,
            show_in_finder,
            open_file,
            move_to_trash,
            copy_to_clipboard,
            open_in_terminal,
            preview_file,
            get_disks,
            get_disk_info,
            check_cache,
            load_from_cache,
            delete_cache,
            clear_all_caches,
            get_scan_history,
            find_duplicates,
            cancel_duplicate_scan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
