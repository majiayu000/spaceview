//! Duplicate file detection using content hashing
//!
//! Strategy:
//! 1. Group files by size (only same-size files can be duplicates)
//! 2. For groups with >1 file, compute partial hash (first 64KB)
//! 3. For groups with matching partial hash, compute full hash
//! 4. Return groups of duplicates

use dashmap::DashMap;
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use ignore::WalkBuilder;

const PARTIAL_HASH_SIZE: u64 = 64 * 1024; // 64KB for quick comparison
const MIN_FILE_SIZE: u64 = 1; // Minimum file size to consider (skip empty files)

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub files: Vec<DuplicateFile>,
    pub wasted_bytes: u64, // size * (count - 1)
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateFile {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateProgress {
    pub phase: String, // "scanning" | "grouping" | "hashing" | "complete"
    pub scanned_files: u64,
    pub groups_found: u64,
    pub files_hashed: u64,
    pub total_to_hash: u64,
    pub current_file: String,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateResult {
    pub groups: Vec<DuplicateGroup>,
    pub total_duplicates: u64,
    pub total_wasted_bytes: u64,
    pub files_scanned: u64,
    pub files_hashed: u64,
    pub time_ms: u64,
}

pub struct DuplicateFinder {
    is_cancelled: Arc<AtomicBool>,
}

impl DuplicateFinder {
    pub fn new() -> Self {
        Self {
            is_cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.is_cancelled.store(true, Ordering::Release);
    }

    pub fn reset(&self) {
        self.is_cancelled.store(false, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.is_cancelled.load(Ordering::Acquire)
    }

    pub fn find_duplicates(
        &self,
        root_path: &Path,
        min_size: Option<u64>,
        app_handle: &AppHandle,
    ) -> Option<DuplicateResult> {
        self.reset();
        let start = std::time::Instant::now();
        let min_size = min_size.unwrap_or(MIN_FILE_SIZE);

        // Phase 1: Collect all files with their sizes
        let _ = app_handle.emit("duplicate-progress", DuplicateProgress {
            phase: "scanning".to_string(),
            scanned_files: 0,
            groups_found: 0,
            files_hashed: 0,
            total_to_hash: 0,
            current_file: "Scanning files...".to_string(),
            is_complete: false,
        });

        let files_by_size: Arc<DashMap<u64, Vec<PathBuf>>> = Arc::new(DashMap::new());
        let scanned_files = Arc::new(AtomicU64::new(0));

        let walker = WalkBuilder::new(root_path)
            .hidden(false)
            .ignore(false)
            .git_ignore(false)
            .follow_links(false)
            .threads(num_cpus::get())
            .build_parallel();

        let files_by_size_clone = files_by_size.clone();
        let scanned_files_clone = scanned_files.clone();
        let cancelled = self.is_cancelled.clone();

        walker.run(|| {
            let files = files_by_size_clone.clone();
            let counter = scanned_files_clone.clone();
            let cancel = cancelled.clone();

            Box::new(move |entry| {
                if cancel.load(Ordering::Acquire) {
                    return ignore::WalkState::Quit;
                }

                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => return ignore::WalkState::Continue,
                };

                let path = entry.path();

                // Skip directories and symlinks
                if let Some(ft) = entry.file_type() {
                    if !ft.is_file() {
                        return ignore::WalkState::Continue;
                    }
                }

                // Get file size
                if let Ok(meta) = entry.metadata() {
                    let size = meta.len();
                    if size >= min_size {
                        files.entry(size)
                            .or_insert_with(Vec::new)
                            .push(path.to_path_buf());
                        counter.fetch_add(1, Ordering::Relaxed);
                    }
                }

                ignore::WalkState::Continue
            })
        });

        if self.is_cancelled() {
            return None;
        }

        let total_files = scanned_files.load(Ordering::Relaxed);
        println!("[Duplicates] Scanned {} files", total_files);

        // Phase 2: Filter to only sizes with multiple files
        let _ = app_handle.emit("duplicate-progress", DuplicateProgress {
            phase: "grouping".to_string(),
            scanned_files: total_files,
            groups_found: 0,
            files_hashed: 0,
            total_to_hash: 0,
            current_file: "Grouping by size...".to_string(),
            is_complete: false,
        });

        let candidate_groups: Vec<(u64, Vec<PathBuf>)> = files_by_size
            .iter()
            .filter(|entry| entry.value().len() > 1)
            .map(|entry| (*entry.key(), entry.value().clone()))
            .collect();

        let total_candidates: u64 = candidate_groups.iter().map(|(_, v)| v.len() as u64).sum();
        let groups_count = candidate_groups.len() as u64;

        println!("[Duplicates] Found {} size groups with {} candidate files",
            groups_count, total_candidates);

        if self.is_cancelled() {
            return None;
        }

        // Phase 3: Hash files and find true duplicates
        let _ = app_handle.emit("duplicate-progress", DuplicateProgress {
            phase: "hashing".to_string(),
            scanned_files: total_files,
            groups_found: groups_count,
            files_hashed: 0,
            total_to_hash: total_candidates,
            current_file: "Computing file hashes...".to_string(),
            is_complete: false,
        });

        let files_hashed = Arc::new(AtomicU64::new(0));
        let duplicate_groups: Arc<DashMap<String, (u64, Vec<PathBuf>)>> = Arc::new(DashMap::new());
        let cancelled = self.is_cancelled.clone();
        let app = app_handle.clone();
        let hashed = files_hashed.clone();

        // Process each size group in parallel
        candidate_groups.par_iter().for_each(|(size, paths)| {
            if cancelled.load(Ordering::Acquire) {
                return;
            }

            // For each file in the group, compute hash
            let hashes: Vec<(PathBuf, Option<String>)> = paths
                .par_iter()
                .map(|path| {
                    if cancelled.load(Ordering::Acquire) {
                        return (path.clone(), None);
                    }

                    let hash = compute_file_hash(path, *size);
                    let count = hashed.fetch_add(1, Ordering::Relaxed);

                    // Emit progress every 100 files
                    if count % 100 == 0 {
                        let _ = app.emit("duplicate-progress", DuplicateProgress {
                            phase: "hashing".to_string(),
                            scanned_files: total_files,
                            groups_found: groups_count,
                            files_hashed: count,
                            total_to_hash: total_candidates,
                            current_file: path.to_string_lossy().to_string(),
                            is_complete: false,
                        });
                    }

                    (path.clone(), hash)
                })
                .collect();

            // Group by hash
            let mut hash_groups: std::collections::HashMap<String, Vec<PathBuf>> =
                std::collections::HashMap::new();

            for (path, hash) in hashes {
                if let Some(h) = hash {
                    hash_groups.entry(h).or_insert_with(Vec::new).push(path);
                }
            }

            // Add groups with duplicates
            for (hash, files) in hash_groups {
                if files.len() > 1 {
                    duplicate_groups.insert(hash, (*size, files));
                }
            }
        });

        if self.is_cancelled() {
            return None;
        }

        // Convert to result format
        let mut result_groups: Vec<DuplicateGroup> = duplicate_groups
            .iter()
            .map(|entry| {
                let (hash, (size, paths)) = (entry.key().clone(), entry.value().clone());
                let files: Vec<DuplicateFile> = paths
                    .iter()
                    .map(|p| DuplicateFile {
                        path: p.to_string_lossy().to_string(),
                        name: p.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                    })
                    .collect();
                let wasted = size * (files.len() as u64 - 1);
                DuplicateGroup {
                    hash,
                    size,
                    files,
                    wasted_bytes: wasted,
                }
            })
            .collect();

        // Sort by wasted space (descending)
        result_groups.sort_by(|a, b| b.wasted_bytes.cmp(&a.wasted_bytes));

        let total_duplicates: u64 = result_groups.iter().map(|g| g.files.len() as u64).sum();
        let total_wasted: u64 = result_groups.iter().map(|g| g.wasted_bytes).sum();
        let files_hashed_count = files_hashed.load(Ordering::Relaxed);
        let elapsed = start.elapsed().as_millis() as u64;

        println!("[Duplicates] Found {} duplicate groups", result_groups.len());
        println!("[Duplicates] Total {} duplicate files, {} wasted bytes",
            total_duplicates, total_wasted);
        println!("[Duplicates] Completed in {}ms", elapsed);

        let _ = app_handle.emit("duplicate-progress", DuplicateProgress {
            phase: "complete".to_string(),
            scanned_files: total_files,
            groups_found: result_groups.len() as u64,
            files_hashed: files_hashed_count,
            total_to_hash: total_candidates,
            current_file: String::new(),
            is_complete: true,
        });

        Some(DuplicateResult {
            groups: result_groups,
            total_duplicates,
            total_wasted_bytes: total_wasted,
            files_scanned: total_files,
            files_hashed: files_hashed_count,
            time_ms: elapsed,
        })
    }
}

fn compute_file_hash(path: &Path, size: u64) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();

    // For small files, hash entire content
    // For large files, hash first 64KB + last 64KB + size (optimization)
    if size <= PARTIAL_HASH_SIZE * 2 {
        // Hash entire file
        let mut buffer = vec![0u8; size as usize];
        reader.read_exact(&mut buffer).ok()?;
        hasher.update(&buffer);
    } else {
        // Hash first 64KB
        let mut buffer = vec![0u8; PARTIAL_HASH_SIZE as usize];
        reader.read_exact(&mut buffer).ok()?;
        hasher.update(&buffer);

        // Hash last 64KB
        reader.seek(SeekFrom::End(-(PARTIAL_HASH_SIZE as i64))).ok()?;
        reader.read_exact(&mut buffer).ok()?;
        hasher.update(&buffer);

        // Include file size in hash to reduce false positives
        hasher.update(size.to_le_bytes());
    }

    let result = hasher.finalize();
    Some(format!("{:x}", result))
}
