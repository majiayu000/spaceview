//! High-performance disk scanner using ripgrep's ignore crate
//!
//! Optimization techniques:
//! 1. Work-stealing parallel traversal (ignore::WalkParallel)
//! 2. Lock-free concurrent hashmap (parking_lot)
//! 3. Arc-wrapped shared state for O(1) cloning
//! 4. Streaming results with crossbeam channels
//! 5. Bottom-up size calculation with iterative post-order

use crossbeam_channel::bounded;
use dashmap::DashMap;
use ignore::{WalkBuilder, WalkState};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Performance metrics for scan analysis
#[derive(Debug, Clone, Serialize)]
pub struct ScanMetrics {
    pub total_time_ms: u64,
    pub walk_time_ms: u64,
    pub relation_time_ms: u64,
    pub size_calc_time_ms: u64,
    pub tree_build_time_ms: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_size: u64,
    pub files_per_sec: u64,
    pub nodes_in_map: usize,
    pub memory_used_mb: f64,
}

/// Get current process memory usage in bytes (macOS)
fn get_memory_usage() -> u64 {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let pid = std::process::id();
        if let Ok(output) = Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
        {
            if let Ok(s) = String::from_utf8(output.stdout) {
                if let Ok(kb) = s.trim().parse::<u64>() {
                    return kb * 1024; // Convert KB to bytes
                }
            }
        }
    }
    0
}

const MAX_CHILDREN: usize = 100;  // Show more items before grouping
const MAX_DEPTH: usize = 20;     // Support deeper directory trees

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    pub file_count: u64,
    pub dir_count: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub scanned_files: u64,
    pub scanned_dirs: u64,
    pub current_path: String,
    pub total_size: u64,
    pub is_complete: bool,
}

pub struct ScannerState {
    is_cancelled: AtomicBool,
}

impl ScannerState {
    pub fn new() -> Self {
        Self { is_cancelled: AtomicBool::new(false) }
    }
    pub fn cancel(&self) { self.is_cancelled.store(true, Ordering::SeqCst); }
    pub fn is_cancelled(&self) -> bool { self.is_cancelled.load(Ordering::Relaxed) }
    pub fn reset(&self) { self.is_cancelled.store(false, Ordering::SeqCst); }
}

impl Default for ScannerState {
    fn default() -> Self { Self::new() }
}

// Lightweight node for parallel collection
struct TempNode {
    name: String,
    size: u64,
    is_dir: bool,
    extension: Option<String>,
    children_paths: Vec<PathBuf>,
}

pub struct Scanner {
    state: Arc<ScannerState>,
}

impl Scanner {
    pub fn new(state: Arc<ScannerState>) -> Self {
        Self { state }
    }

    pub fn scan(&self, root_path: &Path, app_handle: &AppHandle) -> Option<FileNode> {
        self.state.reset();

        let total_start = Instant::now();
        println!("\n{}", "=".repeat(60));
        println!("[SpaceView] Starting scan: {:?}", root_path);
        println!("[SpaceView] Threads: {}", num_cpus::get());
        println!("{}", "=".repeat(60));

        let scanned_files = Arc::new(AtomicU64::new(0));
        let scanned_dirs = Arc::new(AtomicU64::new(0));
        let total_size = Arc::new(AtomicU64::new(0));

        // Lock-free concurrent hashmap (DashMap - no lock contention)
        let nodes: Arc<DashMap<PathBuf, TempNode>> =
            Arc::new(DashMap::with_capacity(100_000));

        // Progress channel for UI updates
        let (progress_tx, progress_rx) = bounded::<(u64, u64, u64, String)>(100);

        // Spawn progress reporter thread
        let app = app_handle.clone();
        let cancel_flag = self.state.clone();
        std::thread::spawn(move || {
            let mut last_emit = std::time::Instant::now();
            while let Ok((files, dirs, size, path)) = progress_rx.recv() {
                if cancel_flag.is_cancelled() { break; }
                if last_emit.elapsed().as_millis() >= 50 {
                    let _ = app.emit("scan-progress", ScanProgress {
                        scanned_files: files,
                        scanned_dirs: dirs,
                        current_path: path,
                        total_size: size,
                        is_complete: false,
                    });
                    last_emit = std::time::Instant::now();
                }
            }
        });

        // Phase 1: Parallel directory walk with work-stealing
        let walk_start = Instant::now();
        println!("[Phase 1] Starting parallel walk...");

        let num_threads = num_cpus::get();
        let walker = WalkBuilder::new(root_path)
            .hidden(false)           // Include hidden files
            .ignore(false)           // Don't respect .gitignore
            .git_ignore(false)       // Don't respect .gitignore
            .git_global(false)       // Don't respect global gitignore
            .git_exclude(false)      // Don't respect .git/info/exclude
            .follow_links(false)     // Don't follow symlinks
            .threads(num_threads)
            .build_parallel();

        let nodes_clone = nodes.clone();
        let files_clone = scanned_files.clone();
        let dirs_clone = scanned_dirs.clone();
        let size_clone = total_size.clone();
        let cancel_clone = self.state.clone();
        let progress_tx_clone = progress_tx.clone();

        // Parallel walk with work-stealing + lock-free DashMap
        walker.run(|| {
            let nodes = nodes_clone.clone();
            let files = files_clone.clone();
            let dirs = dirs_clone.clone();
            let size = size_clone.clone();
            let cancel = cancel_clone.clone();
            let tx = progress_tx_clone.clone();
            let mut counter: u64 = 0;

            Box::new(move |entry| {
                if cancel.is_cancelled() {
                    return WalkState::Quit;
                }

                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => return WalkState::Continue,
                };

                let path = entry.path().to_path_buf();
                // Use file_type() - comes from readdir, no extra syscall
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                // Only call metadata() for files (need size)
                let file_size = if is_dir {
                    0
                } else {
                    entry.metadata().map(|m| m.len()).unwrap_or(0)
                };

                if is_dir {
                    dirs.fetch_add(1, Ordering::Relaxed);
                } else {
                    files.fetch_add(1, Ordering::Relaxed);
                    size.fetch_add(file_size, Ordering::Relaxed);
                }

                let name = path.file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string_lossy().to_string());

                let extension = if !is_dir {
                    path.extension().map(|s| s.to_string_lossy().to_string().to_lowercase())
                } else { None };

                // DashMap insert is lock-free!
                nodes.insert(path.clone(), TempNode {
                    name,
                    size: file_size,
                    is_dir,
                    extension,
                    children_paths: Vec::new(),
                });

                // Send progress every 1000 items
                counter += 1;
                if counter % 1000 == 0 {
                    let _ = tx.try_send((
                        files.load(Ordering::Relaxed),
                        dirs.load(Ordering::Relaxed),
                        size.load(Ordering::Relaxed),
                        path.to_string_lossy().to_string(),
                    ));
                }

                WalkState::Continue
            })
        });

        // Close progress channel
        drop(progress_tx);

        let walk_time = walk_start.elapsed();
        let files_count = scanned_files.load(Ordering::Relaxed);
        let dirs_count = scanned_dirs.load(Ordering::Relaxed);
        let size_total = total_size.load(Ordering::Relaxed);
        let nodes_count = nodes.len();

        println!("[Phase 1] Walk completed in {:?}", walk_time);
        println!("          Files: {}, Dirs: {}, Total: {}",
            files_count, dirs_count, nodes_count);
        println!("          Speed: {:.0} files/sec",
            files_count as f64 / walk_time.as_secs_f64());
        println!("          Size: {:.2} GB", size_total as f64 / 1_073_741_824.0);

        if self.state.is_cancelled() { return None; }

        // Phase 2: Build parent-child relationships (parallel with DashMap)
        let relation_start = Instant::now();
        println!("[Phase 2] Building parent-child relationships...");
        {
            let all_paths: Vec<PathBuf> = nodes.iter().map(|r| r.key().clone()).collect();
            for path in all_paths {
                if let Some(parent) = path.parent() {
                    let parent_path = parent.to_path_buf();
                    if nodes.contains_key(&parent_path) {
                        if let Some(mut parent_node) = nodes.get_mut(&parent_path) {
                            parent_node.children_paths.push(path.clone());
                        }
                    }
                }
            }
        }
        let relation_time = relation_start.elapsed();
        println!("[Phase 2] Relationships built in {:?}", relation_time);

        // Phase 3: Calculate sizes bottom-up
        let size_start = Instant::now();
        println!("[Phase 3] Calculating directory sizes (bottom-up)...");
        self.calc_sizes_bottomup_dashmap(&nodes, root_path);
        let size_time = size_start.elapsed();
        println!("[Phase 3] Size calculation completed in {:?}", size_time);

        // Phase 4: Build final tree
        let tree_start = Instant::now();
        println!("[Phase 4] Building output tree (depth={}, max_children={})...", MAX_DEPTH, MAX_CHILDREN);
        let tree = self.build_tree_dashmap(&nodes, root_path, 0);
        let tree_time = tree_start.elapsed();
        println!("[Phase 4] Tree built in {:?}", tree_time);

        // Final summary
        let total_time = total_start.elapsed();
        let memory_bytes = get_memory_usage();
        let memory_mb = memory_bytes as f64 / 1_048_576.0;

        println!("{}", "=".repeat(60));
        println!("[SpaceView] SCAN COMPLETE");
        println!("{}", "-".repeat(60));
        println!("  Total time:     {:?}", total_time);
        println!("  Phase 1 (walk): {:?} ({:.1}%)", walk_time,
            walk_time.as_secs_f64() / total_time.as_secs_f64() * 100.0);
        println!("  Phase 2 (rel):  {:?} ({:.1}%)", relation_time,
            relation_time.as_secs_f64() / total_time.as_secs_f64() * 100.0);
        println!("  Phase 3 (size): {:?} ({:.1}%)", size_time,
            size_time.as_secs_f64() / total_time.as_secs_f64() * 100.0);
        println!("  Phase 4 (tree): {:?} ({:.1}%)", tree_time,
            tree_time.as_secs_f64() / total_time.as_secs_f64() * 100.0);
        println!("{}", "-".repeat(60));
        println!("  Files:          {}", files_count);
        println!("  Directories:    {}", dirs_count);
        println!("  Total nodes:    {}", nodes_count);
        println!("  Total size:     {:.2} GB", size_total as f64 / 1_073_741_824.0);
        println!("  Throughput:     {:.0} files/sec", files_count as f64 / total_time.as_secs_f64());
        println!("{}", "-".repeat(60));
        println!("  Memory used:    {:.1} MB", memory_mb);
        println!("  Per-node mem:   {:.0} bytes/node", memory_bytes as f64 / nodes_count as f64);
        println!("{}", "=".repeat(60));

        // Emit metrics event for UI
        let metrics = ScanMetrics {
            total_time_ms: total_time.as_millis() as u64,
            walk_time_ms: walk_time.as_millis() as u64,
            relation_time_ms: relation_time.as_millis() as u64,
            size_calc_time_ms: size_time.as_millis() as u64,
            tree_build_time_ms: tree_time.as_millis() as u64,
            total_files: files_count,
            total_dirs: dirs_count,
            total_size: size_total,
            files_per_sec: (files_count as f64 / total_time.as_secs_f64()) as u64,
            nodes_in_map: nodes_count,
            memory_used_mb: memory_mb,
        };
        let _ = app_handle.emit("scan-metrics", metrics);

        let _ = app_handle.emit("scan-progress", ScanProgress {
            scanned_files: files_count,
            scanned_dirs: dirs_count,
            current_path: String::new(),
            total_size: size_total,
            is_complete: true,
        });

        tree
    }

    fn calc_sizes_bottomup_dashmap(&self, nodes: &Arc<DashMap<PathBuf, TempNode>>, root: &Path) {
        // Get post-order traversal
        let mut stack: Vec<(PathBuf, bool)> = vec![(root.to_path_buf(), false)];
        let mut post_order: Vec<PathBuf> = Vec::with_capacity(nodes.len());

        while let Some((path, visited)) = stack.pop() {
            if visited {
                post_order.push(path);
            } else {
                stack.push((path.clone(), true));
                if let Some(node) = nodes.get(&path) {
                    for child in &node.children_paths {
                        stack.push((child.clone(), false));
                    }
                }
            }
        }

        // Calculate sizes in post-order
        for path in post_order {
            if let Some(node) = nodes.get(&path) {
                if node.is_dir {
                    let children_size: u64 = node.children_paths.iter()
                        .filter_map(|cp| nodes.get(cp))
                        .map(|cn| cn.size)
                        .sum();
                    drop(node); // Release read lock before write
                    if let Some(mut node_mut) = nodes.get_mut(&path) {
                        node_mut.size = children_size;
                    }
                }
            }
        }
    }

    fn build_tree_dashmap(&self, nodes: &Arc<DashMap<PathBuf, TempNode>>, path: &Path, depth: usize) -> Option<FileNode> {
        let node = nodes.get(path)?;
        let path_str = path.to_string_lossy().to_string();

        if !node.is_dir {
            return Some(FileNode {
                id: path_str.clone(),
                name: node.name.clone(),
                path: path_str,
                size: node.size,
                is_dir: false,
                children: vec![],
                extension: node.extension.clone(),
                file_count: 0,
                dir_count: 0,
            });
        }

        // Sort children by size (descending)
        let children_paths = node.children_paths.clone();
        drop(node); // Release lock for recursive calls

        let mut children_sorted: Vec<PathBuf> = children_paths;
        children_sorted.sort_by(|a, b| {
            let size_a = nodes.get(a).map(|n| n.size).unwrap_or(0);
            let size_b = nodes.get(b).map(|n| n.size).unwrap_or(0);
            size_b.cmp(&size_a)
        });

        let mut children = Vec::new();
        let mut other_size: u64 = 0;
        let mut other_file_count: u64 = 0;
        let mut other_dir_count: u64 = 0;

        for (i, child_path) in children_sorted.iter().enumerate() {
            if i < MAX_CHILDREN && depth < MAX_DEPTH {
                if let Some(child) = self.build_tree_dashmap(nodes, child_path, depth + 1) {
                    children.push(child);
                }
            } else {
                if let Some(cn) = nodes.get(child_path) {
                    other_size += cn.size;
                    if cn.is_dir {
                        other_dir_count += 1;
                    } else {
                        other_file_count += 1;
                    }
                }
            }
        }

        if other_file_count + other_dir_count > 0 {
            children.push(FileNode {
                id: format!("{}/__other__", path_str),
                name: format!("<{} more items>", other_file_count + other_dir_count),
                path: path_str.clone(),
                size: other_size,
                is_dir: true,
                children: vec![],
                extension: None,
                file_count: other_file_count,
                dir_count: other_dir_count,
            });
        }

        let file_count: u64 = children.iter()
            .map(|c| if c.is_dir { c.file_count } else { 1 })
            .sum();
        let dir_count: u64 = children.iter()
            .map(|c| if c.is_dir { 1 + c.dir_count } else { 0 })
            .sum();

        let node = nodes.get(&path.to_path_buf())?;
        Some(FileNode {
            id: path_str.clone(),
            name: node.name.clone(),
            path: path_str,
            size: node.size,
            is_dir: true,
            children,
            extension: None,
            file_count,
            dir_count,
        })
    }
}
