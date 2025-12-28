mod scanner;

use scanner::{FileNode, Scanner, ScannerState};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

/// Global scanner state
pub struct AppState {
    scanner_state: Arc<ScannerState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            scanner_state: Arc::new(ScannerState::new()),
        }
    }
}

/// Scan a specific directory
#[tauri::command]
async fn scan_directory(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<FileNode>, String> {
    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !path_buf.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let scanner = Scanner::new(state.scanner_state.clone());

    // Run scanning in a blocking task to not block the async runtime
    let result = tokio::task::spawn_blocking(move || scanner.scan(&path_buf, &app_handle))
        .await
        .map_err(|e| e.to_string())?;

    Ok(result)
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
            cancel_scan,
            show_in_finder,
            open_file,
            move_to_trash,
            get_disks,
            get_disk_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
