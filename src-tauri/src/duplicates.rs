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
    pub full_hash_files: u64,
    pub partial_collision_groups: u64,
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
                            .or_default()
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
        let full_hash_files = Arc::new(AtomicU64::new(0));
        let partial_collision_groups = Arc::new(AtomicU64::new(0));
        let duplicate_groups: Arc<DashMap<String, (u64, Vec<PathBuf>)>> = Arc::new(DashMap::new());
        let cancelled = self.is_cancelled.clone();
        let app = app_handle.clone();
        let hashed = files_hashed.clone();
        let full_hashed = full_hash_files.clone();
        let partial_collisions = partial_collision_groups.clone();

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

                    let hash = compute_partial_hash(path, *size);
                    let count = hashed.fetch_add(1, Ordering::Relaxed);

                    // Emit progress every 100 files
                    if count.is_multiple_of(100) {
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

            let group_result = group_duplicates_for_hashes(*size, hashes);
            if group_result.partial_collision_groups > 0 {
                partial_collisions.fetch_add(group_result.partial_collision_groups, Ordering::Relaxed);
            }
            if group_result.full_hash_files > 0 {
                full_hashed.fetch_add(group_result.full_hash_files, Ordering::Relaxed);
            }
            for (hash, files) in group_result.groups {
                duplicate_groups.insert(hash, (*size, files));
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
            full_hash_files: full_hash_files.load(Ordering::Relaxed),
            partial_collision_groups: partial_collision_groups.load(Ordering::Relaxed),
            time_ms: elapsed,
        })
    }
}

struct HashGroupResult {
    groups: Vec<(String, Vec<PathBuf>)>,
    full_hash_files: u64,
    partial_collision_groups: u64,
}

fn group_duplicates_for_hashes(
    size: u64,
    hashes: Vec<(PathBuf, Option<String>)>,
) -> HashGroupResult {
    let mut hash_groups: std::collections::HashMap<String, Vec<PathBuf>> =
        std::collections::HashMap::new();

    for (path, hash) in hashes {
        if let Some(h) = hash {
            hash_groups.entry(h).or_default().push(path);
        }
    }

    if size <= PARTIAL_HASH_SIZE * 2 {
        let groups = hash_groups
            .into_iter()
            .filter(|(_, files)| files.len() > 1)
            .collect();
        return HashGroupResult {
            groups,
            full_hash_files: 0,
            partial_collision_groups: 0,
        };
    }

    let mut full_groups: Vec<(String, Vec<PathBuf>)> = Vec::new();
    let mut full_hash_files: u64 = 0;
    let mut partial_collision_groups: u64 = 0;
    for (_, files) in hash_groups {
        if files.len() <= 1 {
            continue;
        }

        partial_collision_groups += 1;
        full_hash_files += files.len() as u64;
        let mut full_hash_groups: std::collections::HashMap<String, Vec<PathBuf>> =
            std::collections::HashMap::new();
        for path in files {
            if let Some(hash) = compute_full_hash(&path) {
                full_hash_groups.entry(hash).or_default().push(path);
            }
        }

        for (hash, files) in full_hash_groups {
            if files.len() > 1 {
                full_groups.push((hash, files));
            }
        }
    }

    HashGroupResult {
        groups: full_groups,
        full_hash_files,
        partial_collision_groups,
    }
}

fn compute_partial_hash(path: &Path, size: u64) -> Option<String> {
    if size <= PARTIAL_HASH_SIZE * 2 {
        return compute_full_hash(path);
    }

    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; PARTIAL_HASH_SIZE as usize];

    reader.read_exact(&mut buffer).ok()?;
    hasher.update(&buffer);

    reader.seek(SeekFrom::End(-(PARTIAL_HASH_SIZE as i64))).ok()?;
    reader.read_exact(&mut buffer).ok()?;
    hasher.update(&buffer);

    // Include file size in hash to reduce false positives
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
        let prefix = vec![b'A'; PARTIAL_HASH_SIZE as usize];
        let middle = vec![middle_byte; 1024];
        let suffix = vec![b'Z'; PARTIAL_HASH_SIZE as usize];
        file.write_all(&prefix).unwrap();
        file.write_all(&middle).unwrap();
        file.write_all(&suffix).unwrap();
    }

    #[test]
    fn test_duplicates_use_full_hash_for_large_files() {
        let dir = make_temp_dir("spaceview-dup-test");
        let file_a = dir.join("a.bin");
        let file_b = dir.join("b.bin");

        write_patterned_file(&file_a, b'B');
        write_patterned_file(&file_b, b'C');

        let size = fs::metadata(&file_a).unwrap().len();

        let hashes = vec![
            (file_a.clone(), compute_partial_hash(&file_a, size)),
            (file_b.clone(), compute_partial_hash(&file_b, size)),
        ];

        assert_eq!(hashes[0].1, hashes[1].1, "partial hashes should match");

        let groups = group_duplicates_for_hashes(size, hashes);
        assert!(groups.groups.is_empty(), "full hash should avoid false duplicates");

        let _ = fs::remove_dir_all(dir);
    }
}
