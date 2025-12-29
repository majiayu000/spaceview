//! Scan snapshot comparison functionality
//!
//! Compares two scan snapshots of the same directory taken at different times.
//! Identifies files that were added, removed, or changed in size.

use crate::scanner::FileNode;
use dashmap::DashMap;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;

/// A file entry for comparison purposes
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified: u64,
}

/// A file that changed size between snapshots
#[derive(Debug, Clone, Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub name: String,
    pub old_size: u64,
    pub new_size: u64,
    pub size_diff: i64,
    pub is_dir: bool,
}

/// Result of comparing two snapshots
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotCompareResult {
    pub scan_path: String,
    pub old_timestamp: u64,
    pub new_timestamp: u64,
    /// Files added (exist in new but not in old)
    pub added: Vec<SnapshotFile>,
    /// Files removed (exist in old but not in new)
    pub removed: Vec<SnapshotFile>,
    /// Files that changed size
    pub changed: Vec<ChangedFile>,
    /// Total size of added files
    pub added_size: u64,
    /// Total size of removed files
    pub removed_size: u64,
    /// Net size change (positive = grew, negative = shrunk)
    pub net_size_change: i64,
    /// Number of unchanged files
    pub unchanged_count: u64,
    /// Comparison time in milliseconds
    pub time_ms: u64,
}

/// Flatten a FileNode tree into a map of path -> (size, is_dir, modified)
fn flatten_tree(node: &FileNode, base_path: &str) -> DashMap<String, (u64, bool, u64)> {
    let map: Arc<DashMap<String, (u64, bool, u64)>> = Arc::new(DashMap::new());
    flatten_tree_recursive(node, base_path, &map);
    Arc::try_unwrap(map).unwrap_or_else(|arc| (*arc).clone())
}

fn flatten_tree_recursive(
    node: &FileNode,
    current_path: &str,
    map: &DashMap<String, (u64, bool, u64)>,
) {
    let path = if current_path.is_empty() {
        node.name.clone()
    } else {
        format!("{}/{}", current_path, node.name)
    };

    map.insert(path.clone(), (node.size, node.is_dir, node.modified_at.unwrap_or(0)));

    // Recursively process children in parallel for large directories
    if node.children.len() > 100 {
        node.children.par_iter().for_each(|child| {
            flatten_tree_recursive(child, &path, map);
        });
    } else {
        for child in &node.children {
            flatten_tree_recursive(child, &path, map);
        }
    }
}

/// Compare two scan snapshots
pub fn compare_snapshots(
    old_root: &FileNode,
    new_root: &FileNode,
    scan_path: &str,
    old_timestamp: u64,
    new_timestamp: u64,
) -> SnapshotCompareResult {
    let start = std::time::Instant::now();

    // Flatten both trees into maps
    let old_files = flatten_tree(old_root, "");
    let new_files = flatten_tree(new_root, "");

    println!(
        "[Snapshot Compare] Old: {} entries, New: {} entries",
        old_files.len(),
        new_files.len()
    );

    // Get all keys
    let old_keys: HashSet<String> = old_files.iter().map(|e| e.key().clone()).collect();
    let new_keys: HashSet<String> = new_files.iter().map(|e| e.key().clone()).collect();

    // Find added files (in new but not in old)
    let added_keys: Vec<String> = new_keys.difference(&old_keys).cloned().collect();
    let added: Vec<SnapshotFile> = added_keys
        .par_iter()
        .filter_map(|key| {
            new_files.get(key).map(|entry| {
                let (size, is_dir, modified) = *entry.value();
                SnapshotFile {
                    path: key.clone(),
                    name: key.split('/').last().unwrap_or(key).to_string(),
                    size,
                    is_dir,
                    modified,
                }
            })
        })
        .collect();

    // Find removed files (in old but not in new)
    let removed_keys: Vec<String> = old_keys.difference(&new_keys).cloned().collect();
    let removed: Vec<SnapshotFile> = removed_keys
        .par_iter()
        .filter_map(|key| {
            old_files.get(key).map(|entry| {
                let (size, is_dir, modified) = *entry.value();
                SnapshotFile {
                    path: key.clone(),
                    name: key.split('/').last().unwrap_or(key).to_string(),
                    size,
                    is_dir,
                    modified,
                }
            })
        })
        .collect();

    // Find changed files (in both but different size)
    let common_keys: Vec<String> = old_keys.intersection(&new_keys).cloned().collect();
    let mut changed: Vec<ChangedFile> = Vec::new();
    let mut unchanged_count: u64 = 0;

    for key in &common_keys {
        if let (Some(old_entry), Some(new_entry)) = (old_files.get(key), new_files.get(key)) {
            let (old_size, is_dir, _) = *old_entry.value();
            let (new_size, _, _) = *new_entry.value();

            if old_size != new_size {
                changed.push(ChangedFile {
                    path: key.clone(),
                    name: key.split('/').last().unwrap_or(key).to_string(),
                    old_size,
                    new_size,
                    size_diff: new_size as i64 - old_size as i64,
                    is_dir,
                });
            } else {
                unchanged_count += 1;
            }
        }
    }

    // Sort results
    let mut added = added;
    let mut removed = removed;
    added.sort_by(|a, b| b.size.cmp(&a.size));
    removed.sort_by(|a, b| b.size.cmp(&a.size));
    changed.sort_by(|a, b| b.size_diff.abs().cmp(&a.size_diff.abs()));

    // Calculate totals
    let added_size: u64 = added.iter().filter(|f| !f.is_dir).map(|f| f.size).sum();
    let removed_size: u64 = removed.iter().filter(|f| !f.is_dir).map(|f| f.size).sum();
    let change_diff: i64 = changed.iter().map(|f| f.size_diff).sum();
    let net_size_change = added_size as i64 - removed_size as i64 + change_diff;

    let elapsed = start.elapsed().as_millis() as u64;

    println!(
        "[Snapshot Compare] Added: {}, Removed: {}, Changed: {}, Unchanged: {}",
        added.len(),
        removed.len(),
        changed.len(),
        unchanged_count
    );
    println!(
        "[Snapshot Compare] Net change: {} bytes, Time: {}ms",
        net_size_change, elapsed
    );

    SnapshotCompareResult {
        scan_path: scan_path.to_string(),
        old_timestamp,
        new_timestamp,
        added,
        removed,
        changed,
        added_size,
        removed_size,
        net_size_change,
        unchanged_count,
        time_ms: elapsed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_file(name: &str, size: u64) -> FileNode {
        FileNode {
            id: name.to_string(),
            name: name.to_string(),
            path: name.to_string(),
            size,
            is_dir: false,
            children: vec![],
            extension: None,
            file_count: 0,
            dir_count: 0,
            modified_at: None,
        }
    }

    fn make_dir(name: &str, children: Vec<FileNode>) -> FileNode {
        let size = children.iter().map(|c| c.size).sum();
        let file_count: u64 = children.iter().map(|c| if c.is_dir { c.file_count } else { 1 }).sum();
        let dir_count: u64 = children.iter().map(|c| if c.is_dir { 1 + c.dir_count } else { 0 }).sum();
        FileNode {
            id: name.to_string(),
            name: name.to_string(),
            path: name.to_string(),
            size,
            is_dir: true,
            children,
            extension: None,
            file_count,
            dir_count,
            modified_at: None,
        }
    }

    #[test]
    fn test_compare_identical() {
        let old = make_dir("root", vec![make_file("a.txt", 100), make_file("b.txt", 200)]);
        let new = make_dir("root", vec![make_file("a.txt", 100), make_file("b.txt", 200)]);

        let result = compare_snapshots(&old, &new, "/test", 1000, 2000);

        assert!(result.added.is_empty());
        assert!(result.removed.is_empty());
        assert!(result.changed.is_empty());
        assert_eq!(result.unchanged_count, 3); // root + 2 files
        assert_eq!(result.net_size_change, 0);
    }

    #[test]
    fn test_compare_added_file() {
        let old = make_dir("root", vec![make_file("a.txt", 100)]);
        let new = make_dir(
            "root",
            vec![make_file("a.txt", 100), make_file("b.txt", 200)],
        );

        let result = compare_snapshots(&old, &new, "/test", 1000, 2000);

        assert_eq!(result.added.len(), 1);
        assert_eq!(result.added[0].name, "b.txt");
        assert_eq!(result.added[0].size, 200);
        assert!(result.removed.is_empty());
        assert_eq!(result.added_size, 200);
    }

    #[test]
    fn test_compare_removed_file() {
        let old = make_dir(
            "root",
            vec![make_file("a.txt", 100), make_file("b.txt", 200)],
        );
        let new = make_dir("root", vec![make_file("a.txt", 100)]);

        let result = compare_snapshots(&old, &new, "/test", 1000, 2000);

        assert!(result.added.is_empty());
        assert_eq!(result.removed.len(), 1);
        assert_eq!(result.removed[0].name, "b.txt");
        assert_eq!(result.removed_size, 200);
    }

    #[test]
    fn test_compare_changed_size() {
        let old = make_dir("root", vec![make_file("a.txt", 100)]);
        let new = make_dir("root", vec![make_file("a.txt", 300)]);

        let result = compare_snapshots(&old, &new, "/test", 1000, 2000);

        assert!(result.added.is_empty());
        assert!(result.removed.is_empty());
        assert_eq!(result.changed.len(), 2); // root dir + file

        let file_change = result.changed.iter().find(|c| c.name == "a.txt").unwrap();
        assert_eq!(file_change.old_size, 100);
        assert_eq!(file_change.new_size, 300);
        assert_eq!(file_change.size_diff, 200);
    }
}
