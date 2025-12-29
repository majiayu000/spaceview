//! High-performance disk scanner using ripgrep's ignore crate
//!
//! Optimization techniques:
//! 1. Work-stealing parallel traversal (ignore::WalkParallel)
//! 2. Lock-free concurrent hashmap (parking_lot)
//! 3. Arc-wrapped shared state for O(1) cloning
//! 4. Streaming results with crossbeam channels
//! 5. Bottom-up size calculation with iterative post-order

use crate::settings::Settings;
use crossbeam_channel::bounded;
use dashmap::{DashMap, DashSet};
use ignore::{gitignore::GitignoreBuilder, WalkBuilder, WalkState};
use serde::{Deserialize, Serialize};
use std::os::unix::fs::MetadataExt;
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
    // Memory tracking per phase
    pub memory_after_walk_mb: f64,
    pub memory_after_relations_mb: f64,
    pub memory_peak_mb: f64,
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

const MAX_CHILDREN: usize = 500;   // Children per directory before grouping
const MAX_DEPTH: usize = 25;       // Maximum tree depth
const MAX_TOTAL_NODES: usize = 200_000;  // Limit for IPC transfer (~60MB JSON)

/// Parse a .spaceignore file and return patterns.
/// Format is similar to .gitignore:
/// - One pattern per line
/// - Lines starting with # are comments
/// - Empty lines are ignored
fn parse_spaceignore(root_path: &Path) -> Vec<String> {
    let spaceignore_path = root_path.join(".spaceignore");

    if !spaceignore_path.exists() {
        return Vec::new();
    }

    match std::fs::read_to_string(&spaceignore_path) {
        Ok(content) => {
            content
                .lines()
                .map(|line| line.trim())
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .map(|line| line.to_string())
                .collect()
        }
        Err(e) => {
            eprintln!("[SpaceView] Failed to read .spaceignore: {}", e);
            Vec::new()
        }
    }
}

fn build_ignore_matcher(root_path: &Path, patterns: &[String]) -> Option<ignore::gitignore::Gitignore> {
    if patterns.is_empty() {
        return None;
    }

    let mut builder = GitignoreBuilder::new(root_path);
    for pattern in patterns {
        if let Err(err) = builder.add_line(None, pattern) {
            eprintln!("[SpaceView] Invalid ignore pattern '{}': {}", pattern, err);
        }
    }

    builder.build().ok()
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,  // Unix timestamp in seconds
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub scanned_files: u64,
    pub scanned_dirs: u64,
    pub current_path: String,
    pub total_size: u64,
    pub is_complete: bool,
    pub phase: String,  // "walking" | "relations" | "sizes" | "tree" | "complete"
}

pub struct ScannerState {
    is_cancelled: AtomicBool,
}

impl ScannerState {
    pub fn new() -> Self {
        Self { is_cancelled: AtomicBool::new(false) }
    }

    /// Cancel the scan - uses Release ordering to ensure visibility across threads
    pub fn cancel(&self) {
        self.is_cancelled.store(true, Ordering::Release);
    }

    /// Check if scan is cancelled - uses Acquire ordering to synchronize with cancel()
    pub fn is_cancelled(&self) -> bool {
        self.is_cancelled.load(Ordering::Acquire)
    }

    /// Reset cancellation state - uses Release ordering for next scan
    pub fn reset(&self) {
        self.is_cancelled.store(false, Ordering::Release);
    }
}

impl Default for ScannerState {
    fn default() -> Self { Self::new() }
}

// Lightweight node for parallel collection
// Memory-optimized: files don't allocate children_paths Vec
struct TempNode {
    name: Box<str>,           // Box<str> saves 8 bytes vs String (no capacity)
    size: u64,
    is_dir: bool,
    extension: Option<Box<str>>,
    modified_at: Option<u64>,
    children_paths: Option<Vec<PathBuf>>,  // None for files saves 24 bytes per file
}

pub struct Scanner {
    state: Arc<ScannerState>,
}

impl Scanner {
    pub fn new(state: Arc<ScannerState>) -> Self {
        Self { state }
    }

    pub fn scan(&self, root_path: &Path, app_handle: &AppHandle, settings: &Settings) -> Option<FileNode> {
        self.state.reset();

        let total_start = Instant::now();
        println!("\n{}", "=".repeat(60));
        println!("[SpaceView] Starting scan: {:?}", root_path);
        println!("[SpaceView] Threads: {}", num_cpus::get());
        println!("[SpaceView] Settings: show_hidden={}, max_depth={:?}, ignore_patterns={}",
            settings.show_hidden_files,
            settings.max_scan_depth,
            settings.ignore_patterns.len());
        println!("{}", "=".repeat(60));

        let scanned_files = Arc::new(AtomicU64::new(0));
        let scanned_dirs = Arc::new(AtomicU64::new(0));
        let total_size = Arc::new(AtomicU64::new(0));

        // Lock-free concurrent hashmap (DashMap - no lock contention)
        let nodes: Arc<DashMap<PathBuf, TempNode>> =
            Arc::new(DashMap::with_capacity(100_000));

        // Track seen inodes to avoid counting hard links multiple times
        // Key: (device_id, inode) - uniquely identifies a file on disk
        let seen_inodes: Arc<DashSet<(u64, u64)>> = Arc::new(DashSet::new());

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
                        phase: "walking".to_string(),
                    });
                    last_emit = std::time::Instant::now();
                }
            }
        });

        // Phase 1: Parallel directory walk with work-stealing
        let walk_start = Instant::now();
        println!("[Phase 1] Starting parallel walk...");

        // Pre-compute ignore patterns for efficient matching
        // Combine settings patterns with .spaceignore patterns from the scanned directory
        let spaceignore_patterns = parse_spaceignore(root_path);
        let combined_patterns: Vec<String> = settings
            .ignore_patterns
            .iter()
            .cloned()
            .chain(spaceignore_patterns)
            .collect();

        if !combined_patterns.is_empty() {
            println!("[SpaceView] Using {} ignore patterns ({} from settings, {} from .spaceignore)",
                combined_patterns.len(),
                settings.ignore_patterns.len(),
                combined_patterns.len() - settings.ignore_patterns.len());
        }

        let ignore_matcher = build_ignore_matcher(root_path, &combined_patterns)
            .map(Arc::new);
        let show_hidden = settings.show_hidden_files;
        let max_depth = settings.max_scan_depth;

        let num_threads = num_cpus::get();
        let mut walker_builder = WalkBuilder::new(root_path);
        walker_builder
            .hidden(!show_hidden)    // hidden(true) = skip hidden files
            .ignore(false)           // Don't respect .gitignore
            .git_ignore(false)       // Don't respect .gitignore
            .git_global(false)       // Don't respect global gitignore
            .git_exclude(false)      // Don't respect .git/info/exclude
            .follow_links(false)     // Don't follow symlinks
            .threads(num_threads);

        // Apply max depth if configured
        if let Some(depth) = max_depth {
            walker_builder.max_depth(Some(depth as usize));
        }

        let walker = walker_builder.build_parallel();

        let nodes_clone = nodes.clone();
        let files_clone = scanned_files.clone();
        let dirs_clone = scanned_dirs.clone();
        let size_clone = total_size.clone();
        let cancel_clone = self.state.clone();
        let progress_tx_clone = progress_tx.clone();
        let seen_inodes_clone = seen_inodes.clone();
        let ignore_matcher_clone = ignore_matcher.clone();

        // Parallel walk with work-stealing + lock-free DashMap
        walker.run(|| {
            let nodes = nodes_clone.clone();
            let files = files_clone.clone();
            let dirs = dirs_clone.clone();
            let size = size_clone.clone();
            let cancel = cancel_clone.clone();
            let tx = progress_tx_clone.clone();
            let seen = seen_inodes_clone.clone();
            let matcher = ignore_matcher_clone.clone();
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

                // Check if this path should be ignored
                if let Some(ref matcher) = matcher {
                    let relative = path.strip_prefix(root_path).unwrap_or(&path);
                    let matched = matcher.matched_path_or_any_parents(relative, is_dir);
                    if matched.is_ignore() {
                        // For directories, skip the entire subtree
                        return if is_dir { WalkState::Skip } else { WalkState::Continue };
                    }
                }

                // Get metadata for inode tracking, size, and modification time (files only).
                let (file_size, inode_key, modified_at) = if is_dir {
                    (0, None, None)
                } else if let Ok(meta) = entry.metadata() {
                    let dev = meta.dev();
                    let ino = meta.ino();
                    let size = meta.len();
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs());
                    (size, Some((dev, ino)), mtime)
                } else {
                    (0, None, None)
                };

                // Check for hard links (same file with multiple paths)
                // Only count size for files, and only if we haven't seen this inode before
                let is_duplicate = if let Some(key) = inode_key {
                    if !is_dir {
                        // For files: check if we've seen this inode before
                        !seen.insert(key) // returns false if already present
                    } else {
                        false // Don't dedupe directories
                    }
                } else {
                    false
                };

                if is_dir {
                    dirs.fetch_add(1, Ordering::Relaxed);
                } else {
                    files.fetch_add(1, Ordering::Relaxed);
                    // Only add size if this is NOT a duplicate hard link
                    if !is_duplicate {
                        size.fetch_add(file_size, Ordering::Relaxed);
                    }
                }

                let name = path.file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string_lossy().to_string());

                let extension = if !is_dir {
                    path.extension().map(|s| s.to_string_lossy().to_string().to_lowercase())
                } else { None };

                // For duplicate hard links, store 0 size to avoid double-counting in tree
                let stored_size = if is_duplicate { 0 } else { file_size };

                // DashMap insert is lock-free!
                // Memory optimization: files don't need children_paths Vec
                nodes.insert(path.clone(), TempNode {
                    name: name.into_boxed_str(),
                    size: stored_size,
                    is_dir,
                    extension: extension.map(|s| s.into_boxed_str()),
                    modified_at,
                    children_paths: if is_dir { Some(Vec::new()) } else { None },
                });

                // Send progress every 1000 items
                counter += 1;
                if counter.is_multiple_of(1000) {
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
        let unique_inodes = seen_inodes.len();
        let hard_link_duplicates = files_count.saturating_sub(unique_inodes as u64);

        // Track memory after walk phase
        let memory_after_walk = get_memory_usage();
        let memory_after_walk_mb = memory_after_walk as f64 / 1_048_576.0;
        let mut memory_peak = memory_after_walk;

        println!("[Phase 1] Walk completed in {:?}", walk_time);
        println!("          Files: {}, Dirs: {}, Total: {}",
            files_count, dirs_count, nodes_count);
        println!("          Unique file inodes: {}", unique_inodes);
        if hard_link_duplicates > 0 {
            println!("          Hard link duplicates: {} (size not counted twice)", hard_link_duplicates);
        }
        println!("          Speed: {:.0} files/sec",
            files_count as f64 / walk_time.as_secs_f64());
        println!("          Size: {:.2} GB (deduplicated)", size_total as f64 / 1_073_741_824.0);
        println!("          Memory: {:.1} MB", memory_after_walk_mb);

        if self.state.is_cancelled() { return None; }

        // Phase 2: Build parent-child relationships (parallel with DashMap)
        let _ = app_handle.emit("scan-progress", ScanProgress {
            scanned_files: files_count,
            scanned_dirs: dirs_count,
            current_path: "Building relationships...".to_string(),
            total_size: size_total,
            is_complete: false,
            phase: "relations".to_string(),
        });
        let relation_start = Instant::now();
        println!("[Phase 2] Building parent-child relationships...");

        // Memory optimization: Process in batches to avoid peak memory spike
        // Instead of collecting all pairs at once, process in chunks
        const BATCH_SIZE: usize = 50_000;

        {
            let mut processed_paths: usize = 0;
            let mut batch_idx: usize = 0;
            let mut batch_pairs: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(BATCH_SIZE);

            for entry in nodes.iter() {
                let path = entry.key().clone();
                drop(entry);

                if let Some(parent) = path.parent() {
                    let parent_path = parent.to_path_buf();
                    if nodes.contains_key(&parent_path) {
                        batch_pairs.push((path, parent_path));
                        if batch_pairs.len() >= BATCH_SIZE {
                            for (child_path, parent_path) in batch_pairs.drain(..) {
                                if let Some(mut parent_node) = nodes.get_mut(&parent_path) {
                                    if let Some(ref mut children) = parent_node.children_paths {
                                        children.push(child_path);
                                    }
                                }
                            }
                            batch_idx += 1;

                            if self.state.is_cancelled() {
                                println!("[Phase 2] Cancelled at batch {}", batch_idx);
                                return None;
                            }
                        }
                    }
                }

                processed_paths += 1;
            }

            if !batch_pairs.is_empty() {
                for (child_path, parent_path) in batch_pairs.drain(..) {
                    if let Some(mut parent_node) = nodes.get_mut(&parent_path) {
                        if let Some(ref mut children) = parent_node.children_paths {
                            children.push(child_path);
                        }
                    }
                }
                batch_idx += 1;
            }

            println!(
                "[Phase 2] Processed {} paths in {} batches",
                processed_paths,
                batch_idx
            );
        }

        let relation_time = relation_start.elapsed();

        // Track memory after relations phase
        let memory_after_relations = get_memory_usage();
        let memory_after_relations_mb = memory_after_relations as f64 / 1_048_576.0;
        memory_peak = memory_peak.max(memory_after_relations);

        println!("[Phase 2] Relationships built in {:?}", relation_time);
        println!("          Memory: {:.1} MB (delta: {:+.1} MB)",
            memory_after_relations_mb,
            memory_after_relations_mb - memory_after_walk_mb);

        // Phase 3: Calculate sizes bottom-up
        let _ = app_handle.emit("scan-progress", ScanProgress {
            scanned_files: files_count,
            scanned_dirs: dirs_count,
            current_path: "Calculating sizes...".to_string(),
            total_size: size_total,
            is_complete: false,
            phase: "sizes".to_string(),
        });
        let size_start = Instant::now();
        println!("[Phase 3] Calculating directory sizes (bottom-up)...");
        self.calc_sizes_bottomup_dashmap(&nodes, root_path);
        let size_time = size_start.elapsed();
        println!("[Phase 3] Size calculation completed in {:?}", size_time);

        // Phase 4: Build final tree
        let _ = app_handle.emit("scan-progress", ScanProgress {
            scanned_files: files_count,
            scanned_dirs: dirs_count,
            current_path: "Building tree...".to_string(),
            total_size: size_total,
            is_complete: false,
            phase: "tree".to_string(),
        });
        let tree_start = Instant::now();
        println!("[Phase 4] Building output tree (depth={}, max_children={}, max_nodes={})...", MAX_DEPTH, MAX_CHILDREN, MAX_TOTAL_NODES);
        let tree_node_count = AtomicU64::new(0);
        let tree = self.build_tree_dashmap(&nodes, root_path, 0, &tree_node_count);
        let final_node_count = tree_node_count.load(Ordering::Relaxed);
        let tree_time = tree_start.elapsed();
        println!("[Phase 4] Tree built in {:?} ({} nodes for UI)", tree_time, final_node_count);

        // Measure memory before cleanup
        let memory_before = get_memory_usage();
        let memory_before_mb = memory_before as f64 / 1_048_576.0;
        memory_peak = memory_peak.max(memory_before);

        // Phase 5: Memory cleanup - explicitly drop temporary data structures
        println!("[Phase 5] Releasing temporary memory...");
        let cleanup_start = Instant::now();
        drop(nodes);         // Release DashMap<PathBuf, TempNode>
        drop(seen_inodes);   // Release DashSet<(u64, u64)>
        let cleanup_time = cleanup_start.elapsed();

        // Measure memory after cleanup
        let memory_after = get_memory_usage();
        let memory_after_mb = memory_after as f64 / 1_048_576.0;
        let memory_freed_mb = memory_before_mb - memory_after_mb;
        println!("[Phase 5] Memory released in {:?} ({:.1} MB freed)", cleanup_time, memory_freed_mb.max(0.0));

        // Final summary
        let total_time = total_start.elapsed();

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
        println!("  Peak memory:    {:.1} MB", memory_peak as f64 / 1_048_576.0);
        println!("  Final memory:   {:.1} MB", memory_after_mb);
        if nodes_count > 0 {
            println!("  Per-node mem:   {:.0} bytes/node (peak)", memory_peak as f64 / nodes_count as f64);
        } else {
            println!("  Per-node mem:   n/a");
        }
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
            memory_used_mb: memory_after_mb,  // Report post-cleanup memory
            memory_after_walk_mb,
            memory_after_relations_mb,
            memory_peak_mb: memory_peak as f64 / 1_048_576.0,
        };
        let _ = app_handle.emit("scan-metrics", metrics);

        let _ = app_handle.emit("scan-progress", ScanProgress {
            scanned_files: files_count,
            scanned_dirs: dirs_count,
            current_path: String::new(),
            total_size: size_total,
            is_complete: true,
            phase: "complete".to_string(),
        });

        tree
    }

    fn calc_sizes_bottomup_dashmap(&self, nodes: &Arc<DashMap<PathBuf, TempNode>>, root: &Path) {
        // Get post-order traversal
        let mut stack: Vec<(PathBuf, bool)> = vec![(root.to_path_buf(), false)];

        while let Some((path, visited)) = stack.pop() {
            if visited {
                if let Some(node) = nodes.get(&path) {
                    if node.is_dir {
                        if let Some(ref children) = node.children_paths {
                            let children_size: u64 = children
                                .iter()
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
            } else {
                stack.push((path.clone(), true));
                if let Some(node) = nodes.get(&path) {
                    if let Some(ref children) = node.children_paths {
                        for child in children {
                            stack.push((child.clone(), false));
                        }
                    }
                }
            }
        }
    }

    fn build_tree_dashmap(&self, nodes: &Arc<DashMap<PathBuf, TempNode>>, path: &Path, depth: usize, node_count: &AtomicU64) -> Option<FileNode> {
        // Check total node limit to keep JSON size manageable for IPC
        if node_count.load(Ordering::Relaxed) >= MAX_TOTAL_NODES as u64 {
            return None;
        }
        let node = nodes.get(path)?;
        let path_str = path.to_string_lossy().to_string();

        // Increment node count
        node_count.fetch_add(1, Ordering::Relaxed);

        if !node.is_dir {
            return Some(FileNode {
                id: path_str.clone(),
                name: node.name.to_string(),
                path: path_str,
                size: node.size,
                is_dir: false,
                children: vec![],
                extension: node.extension.as_ref().map(|s| s.to_string()),
                file_count: 0,
                dir_count: 0,
                modified_at: node.modified_at,
            });
        }

        // Sort children by size (descending) while caching size/is_dir metadata.
        let children_paths = node.children_paths.clone().unwrap_or_default();
        drop(node); // Release lock for recursive calls

        let mut children_with_meta: Vec<(PathBuf, u64, bool)> = Vec::with_capacity(children_paths.len());
        for child_path in children_paths {
            if let Some(child_node) = nodes.get(&child_path) {
                children_with_meta.push((child_path, child_node.size, child_node.is_dir));
            }
        }

        children_with_meta.sort_by(|a, b| b.1.cmp(&a.1));

        let mut children = Vec::new();
        let mut other_size: u64 = 0;
        let mut other_file_count: u64 = 0;
        let mut other_dir_count: u64 = 0;

        for (i, (child_path, child_size, child_is_dir)) in children_with_meta.iter().enumerate() {
            // Check all limits: children count, depth, and total nodes
            let at_limit = node_count.load(Ordering::Relaxed) >= MAX_TOTAL_NODES as u64;
            if i < MAX_CHILDREN && depth < MAX_DEPTH && !at_limit {
                if let Some(child) = self.build_tree_dashmap(nodes, child_path, depth + 1, node_count) {
                    children.push(child);
                } else {
                    // Node was skipped due to limit, count as "other"
                    other_size += *child_size;
                    if *child_is_dir {
                        other_dir_count += 1;
                    } else {
                        other_file_count += 1;
                    }
                }
            } else {
                other_size += *child_size;
                if *child_is_dir {
                    other_dir_count += 1;
                } else {
                    other_file_count += 1;
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
                modified_at: None,
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
            name: node.name.to_string(),
            path: path_str,
            size: node.size,
            is_dir: true,
            children,
            extension: None,
            file_count,
            dir_count,
            modified_at: node.modified_at,
        })
    }
}
