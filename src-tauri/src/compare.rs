//! Directory comparison functionality
//!
//! Compares two directories and identifies:
//! 1. Files only in the left directory
//! 2. Files only in the right directory
//! 3. Files that exist in both but are different (size/content)
//! 4. Files that are identical in both

use dashmap::DashMap;
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use ignore::WalkBuilder;

const HASH_SAMPLE_SIZE: u64 = 64 * 1024; // 64KB for quick comparison

#[derive(Debug, Clone, Serialize)]
pub struct CompareFile {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffFile {
    pub relative_path: String,
    pub name: String,
    pub left_size: u64,
    pub right_size: u64,
    pub left_path: String,
    pub right_path: String,
    pub left_is_dir: bool,
    pub right_is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompareProgress {
    pub phase: String, // "scanning_left" | "scanning_right" | "comparing" | "complete"
    pub left_files: u64,
    pub right_files: u64,
    pub compared_files: u64,
    pub total_to_compare: u64,
    pub current_file: String,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompareResult {
    pub left_path: String,
    pub right_path: String,
    pub left_only: Vec<CompareFile>,      // Files only in left
    pub right_only: Vec<CompareFile>,     // Files only in right
    pub different: Vec<DiffFile>,          // Files in both but different
    pub identical_count: u64,              // Count of identical files
    pub left_only_size: u64,
    pub right_only_size: u64,
    pub different_size: u64,               // Size difference in changed files
    pub type_conflict_count: u64,
    pub type_conflict_size: u64,
    pub time_ms: u64,
}

pub struct DirectoryComparer {
    is_cancelled: Arc<AtomicBool>,
}

impl DirectoryComparer {
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

    /// Collect all files in a directory with their relative paths
    fn collect_files(
        &self,
        root: &Path,
        counter: &AtomicU64,
    ) -> Option<DashMap<String, (PathBuf, u64, bool)>> {
        let files: Arc<DashMap<String, (PathBuf, u64, bool)>> = Arc::new(DashMap::new());
        let cancelled = self.is_cancelled.clone();

        let walker = WalkBuilder::new(root)
            .hidden(false)
            .ignore(false)
            .git_ignore(false)
            .follow_links(false)
            .threads(num_cpus::get())
            .build_parallel();

        let files_clone = files.clone();
        let root_str = root.to_string_lossy().to_string();

        walker.run(|| {
            let files = files_clone.clone();
            let cancel = cancelled.clone();
            let root_prefix = root_str.clone();

            Box::new(move |entry| {
                if cancel.load(Ordering::Acquire) {
                    return ignore::WalkState::Quit;
                }

                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => return ignore::WalkState::Continue,
                };

                let path = entry.path();

                // Skip the root directory itself
                if path == Path::new(&root_prefix) {
                    return ignore::WalkState::Continue;
                }

                let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

                // Get relative path
                let relative = path.strip_prefix(&root_prefix)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                if relative.is_empty() {
                    return ignore::WalkState::Continue;
                }

                let size = if is_dir {
                    0
                } else {
                    entry.metadata().map(|m| m.len()).unwrap_or(0)
                };

                files.insert(relative, (path.to_path_buf(), size, is_dir));
                counter.fetch_add(1, Ordering::Relaxed);

                ignore::WalkState::Continue
            })
        });

        if self.is_cancelled() {
            None
        } else {
            Some(Arc::try_unwrap(files).unwrap_or_else(|arc| (*arc).clone()))
        }
    }

    pub fn compare_directories(
        &self,
        left_path: &Path,
        right_path: &Path,
        app_handle: &AppHandle,
    ) -> Option<CompareResult> {
        self.reset();
        let start = std::time::Instant::now();

        // Phase 1: Scan left directory
        let _ = app_handle.emit("compare-progress", CompareProgress {
            phase: "scanning_left".to_string(),
            left_files: 0,
            right_files: 0,
            compared_files: 0,
            total_to_compare: 0,
            current_file: format!("Scanning {}...", left_path.display()),
            is_complete: false,
        });

        let left_counter = AtomicU64::new(0);
        let left_files = self.collect_files(left_path, &left_counter)?;
        let left_count = left_counter.load(Ordering::Relaxed);

        if self.is_cancelled() {
            return None;
        }

        // Phase 2: Scan right directory
        let _ = app_handle.emit("compare-progress", CompareProgress {
            phase: "scanning_right".to_string(),
            left_files: left_count,
            right_files: 0,
            compared_files: 0,
            total_to_compare: 0,
            current_file: format!("Scanning {}...", right_path.display()),
            is_complete: false,
        });

        let right_counter = AtomicU64::new(0);
        let right_files = self.collect_files(right_path, &right_counter)?;
        let right_count = right_counter.load(Ordering::Relaxed);

        if self.is_cancelled() {
            return None;
        }

        println!("[Compare] Left: {} files, Right: {} files", left_count, right_count);

        // Phase 3: Compare files
        let _ = app_handle.emit("compare-progress", CompareProgress {
            phase: "comparing".to_string(),
            left_files: left_count,
            right_files: right_count,
            compared_files: 0,
            total_to_compare: left_count + right_count,
            current_file: "Comparing files...".to_string(),
            is_complete: false,
        });

        let left_keys: HashSet<String> = left_files.iter().map(|e| e.key().clone()).collect();
        let right_keys: HashSet<String> = right_files.iter().map(|e| e.key().clone()).collect();

        // Files only in left
        let left_only_keys: Vec<String> = left_keys.difference(&right_keys).cloned().collect();
        let left_only: Vec<CompareFile> = left_only_keys
            .par_iter()
            .filter_map(|key| {
                left_files.get(key).map(|entry| {
                    let (path, size, is_dir) = entry.value();
                    CompareFile {
                        path: path.to_string_lossy().to_string(),
                        relative_path: key.clone(),
                        name: path.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        size: *size,
                        is_dir: *is_dir,
                    }
                })
            })
            .collect();

        // Files only in right
        let right_only_keys: Vec<String> = right_keys.difference(&left_keys).cloned().collect();
        let right_only: Vec<CompareFile> = right_only_keys
            .par_iter()
            .filter_map(|key| {
                right_files.get(key).map(|entry| {
                    let (path, size, is_dir) = entry.value();
                    CompareFile {
                        path: path.to_string_lossy().to_string(),
                        relative_path: key.clone(),
                        name: path.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        size: *size,
                        is_dir: *is_dir,
                    }
                })
            })
            .collect();

        if self.is_cancelled() {
            return None;
        }

        // Files in both - need to check if they're different
        let common_keys: Vec<String> = left_keys.intersection(&right_keys).cloned().collect();
        let compared = AtomicU64::new(0);
        let cancelled = self.is_cancelled.clone();
        let app = app_handle.clone();

        let comparison_results: Vec<(String, CompareOutcome, u64, u64)> = common_keys
            .par_iter()
            .filter_map(|key| {
                if cancelled.load(Ordering::Acquire) {
                    return None;
                }

                let left_entry = left_files.get(key)?;
                let right_entry = right_files.get(key)?;

                let (left_path, left_size, left_is_dir) = left_entry.value();
                let (right_path, right_size, right_is_dir) = right_entry.value();

                let comparison = compare_entry_pair(
                    left_path,
                    *left_size,
                    *left_is_dir,
                    right_path,
                    *right_size,
                    *right_is_dir,
                )?;

                let count = compared.fetch_add(1, Ordering::Relaxed);
                if count.is_multiple_of(500) {
                    let _ = app.emit("compare-progress", CompareProgress {
                        phase: "comparing".to_string(),
                        left_files: left_count,
                        right_files: right_count,
                        compared_files: count,
                        total_to_compare: common_keys.len() as u64,
                        current_file: key.clone(),
                        is_complete: false,
                    });
                }

                Some((key.clone(), comparison, *left_size, *right_size))
            })
            .collect();

        if self.is_cancelled() {
            return None;
        }

        // Split into different and identical
        let mut different: Vec<DiffFile> = Vec::new();
        let mut identical_count: u64 = 0;
        let mut type_conflict_count: u64 = 0;
        let mut type_conflict_size: u64 = 0;

        for (key, outcome, left_size, right_size) in comparison_results {
            if outcome.is_identical {
                identical_count += 1;
                continue;
            }

            if outcome.is_type_conflict {
                type_conflict_count += 1;
                type_conflict_size += left_size.max(right_size);
            } else if let (Some(left_entry), Some(right_entry)) =
                (left_files.get(&key), right_files.get(&key))
            {
                let (left_path, _, left_is_dir) = left_entry.value();
                let (right_path, _, right_is_dir) = right_entry.value();

                different.push(DiffFile {
                    relative_path: key.clone(),
                    name: Path::new(&key)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    left_size,
                    right_size,
                    left_path: left_path.to_string_lossy().to_string(),
                    right_path: right_path.to_string_lossy().to_string(),
                    left_is_dir: *left_is_dir,
                    right_is_dir: *right_is_dir,
                });
            }
        }

        // Sort results by size (descending)
        let mut left_only = left_only;
        let mut right_only = right_only;

        left_only.sort_by(|a, b| b.size.cmp(&a.size));
        right_only.sort_by(|a, b| b.size.cmp(&a.size));
        different.sort_by(|a, b| {
            let a_diff = (a.left_size as i64 - a.right_size as i64).unsigned_abs();
            let b_diff = (b.left_size as i64 - b.right_size as i64).unsigned_abs();
            b_diff.cmp(&a_diff)
        });

        // Calculate totals
        let left_only_size: u64 = left_only.iter().map(|f| f.size).sum();
        let right_only_size: u64 = right_only.iter().map(|f| f.size).sum();
        let different_size: u64 = different.iter()
            .map(|f| (f.left_size as i64 - f.right_size as i64).unsigned_abs())
            .sum::<u64>()
            .saturating_add(type_conflict_size);

        let elapsed = start.elapsed().as_millis() as u64;

        println!("[Compare] Left only: {}, Right only: {}, Different: {}, Identical: {}",
            left_only.len(), right_only.len(), different.len(), identical_count);
        println!("[Compare] Completed in {}ms", elapsed);

        let _ = app_handle.emit("compare-progress", CompareProgress {
            phase: "complete".to_string(),
            left_files: left_count,
            right_files: right_count,
            compared_files: compared.load(Ordering::Relaxed),
            total_to_compare: common_keys.len() as u64,
            current_file: String::new(),
            is_complete: true,
        });

        Some(CompareResult {
            left_path: left_path.to_string_lossy().to_string(),
            right_path: right_path.to_string_lossy().to_string(),
            left_only,
            right_only,
            different,
            identical_count,
            left_only_size,
            right_only_size,
            different_size,
            type_conflict_count,
            type_conflict_size,
            time_ms: elapsed,
        })
    }
}

struct CompareOutcome {
    is_identical: bool,
    is_type_conflict: bool,
}

fn compare_entry_pair(
    left_path: &Path,
    left_size: u64,
    left_is_dir: bool,
    right_path: &Path,
    right_size: u64,
    right_is_dir: bool,
) -> Option<CompareOutcome> {
    if left_is_dir && right_is_dir {
        return None;
    }

    if left_is_dir != right_is_dir {
        return Some(CompareOutcome {
            is_identical: false,
            is_type_conflict: true,
        });
    }

    if left_size != right_size {
        return Some(CompareOutcome {
            is_identical: false,
            is_type_conflict: false,
        });
    }

    Some(CompareOutcome {
        is_identical: are_files_identical(left_path, right_path, left_size),
        is_type_conflict: false,
    })
}

fn are_files_identical(left_path: &Path, right_path: &Path, size: u64) -> bool {
    if size <= HASH_SAMPLE_SIZE * 2 {
        return match (compute_full_hash(left_path), compute_full_hash(right_path)) {
            (Some(lh), Some(rh)) => lh == rh,
            _ => false,
        };
    }

    let left_partial = compute_partial_hash(left_path, size);
    let right_partial = compute_partial_hash(right_path, size);
    if left_partial.is_none() || right_partial.is_none() {
        return false;
    }
    if left_partial != right_partial {
        return false;
    }

    match (compute_full_hash(left_path), compute_full_hash(right_path)) {
        (Some(lh), Some(rh)) => lh == rh,
        _ => false,
    }
}

fn compute_partial_hash(path: &Path, size: u64) -> Option<String> {
    if size <= HASH_SAMPLE_SIZE * 2 {
        return compute_full_hash(path);
    }

    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; HASH_SAMPLE_SIZE as usize];

    reader.read_exact(&mut buffer).ok()?;
    hasher.update(&buffer);

    reader.seek(SeekFrom::End(-(HASH_SAMPLE_SIZE as i64))).ok()?;
    reader.read_exact(&mut buffer).ok()?;
    hasher.update(&buffer);

    hasher.update(size.to_le_bytes());

    let result = hasher.finalize();
    Some(format!("{:x}", result))
}

fn compute_full_hash(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];

    loop {
        let read = reader.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let result = hasher.finalize();
    Some(format!("{:x}", result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        dir.push(format!("{}-{}-{}", prefix, std::process::id(), nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_patterned_file(path: &Path, middle_byte: u8) {
        let mut file = File::create(path).unwrap();
        let prefix = vec![b'A'; HASH_SAMPLE_SIZE as usize];
        let middle = vec![middle_byte; 1024];
        let suffix = vec![b'Z'; HASH_SAMPLE_SIZE as usize];
        file.write_all(&prefix).unwrap();
        file.write_all(&middle).unwrap();
        file.write_all(&suffix).unwrap();
    }

    #[test]
    fn test_compare_uses_full_hash_for_large_files() {
        let dir = make_temp_dir("spaceview-compare-test");
        let file_a = dir.join("a.bin");
        let file_b = dir.join("b.bin");

        write_patterned_file(&file_a, b'B');
        write_patterned_file(&file_b, b'C');

        let size = fs::metadata(&file_a).unwrap().len();
        assert!(!are_files_identical(&file_a, &file_b, size));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_compare_detects_type_conflict() {
        let dir = make_temp_dir("spaceview-compare-type-test");
        let file_path = dir.join("file.txt");
        let dir_path = dir.join("dir");
        fs::create_dir_all(&dir_path).unwrap();
        fs::write(&file_path, b"content").unwrap();

        let file_size = fs::metadata(&file_path).unwrap().len();
        let comparison = compare_entry_pair(
            &file_path,
            file_size,
            false,
            &dir_path,
            0,
            true,
        );

        assert!(matches!(
            comparison,
            Some(CompareOutcome {
                is_identical: false,
                is_type_conflict: true
            })
        ));

        let _ = fs::remove_dir_all(dir);
    }
}
