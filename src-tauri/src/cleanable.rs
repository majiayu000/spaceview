//! Cleanable files detection for disk space optimization
//!
//! Detects common directories and files that can be safely cleaned
//! to reclaim disk space, such as node_modules, build directories, caches, etc.

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

/// Category of cleanable items
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CleanableCategory {
    /// Package manager caches and dependencies (node_modules, vendor, etc.)
    Dependencies,
    /// Build output directories (dist, build, .next, etc.)
    BuildOutput,
    /// Cache directories (.cache, __pycache__, etc.)
    Cache,
    /// Log files
    Logs,
    /// Temporary files
    Temporary,
    /// IDE/Editor files (.idea, .vscode settings, etc.)
    IdeFiles,
    /// Version control artifacts (.git objects, etc.)
    VcsArtifacts,
    /// System files (.DS_Store, Thumbs.db, etc.)
    SystemFiles,
}

impl CleanableCategory {
    #[allow(dead_code)]
    pub fn description(&self) -> &'static str {
        match self {
            CleanableCategory::Dependencies => "Package dependencies that can be reinstalled",
            CleanableCategory::BuildOutput => "Build output directories",
            CleanableCategory::Cache => "Cache directories",
            CleanableCategory::Logs => "Log files",
            CleanableCategory::Temporary => "Temporary files",
            CleanableCategory::IdeFiles => "IDE and editor files",
            CleanableCategory::VcsArtifacts => "Version control artifacts",
            CleanableCategory::SystemFiles => "System-generated files",
        }
    }

    pub fn risk_level(&self) -> &'static str {
        match self {
            CleanableCategory::Dependencies => "low",
            CleanableCategory::BuildOutput => "low",
            CleanableCategory::Cache => "low",
            CleanableCategory::Logs => "medium",
            CleanableCategory::Temporary => "low",
            CleanableCategory::IdeFiles => "medium",
            CleanableCategory::VcsArtifacts => "high",
            CleanableCategory::SystemFiles => "low",
        }
    }
}

/// A pattern that matches cleanable items
#[derive(Debug, Clone)]
pub struct CleanablePattern {
    /// Pattern name (e.g., "node_modules")
    pub name: &'static str,
    /// Category
    pub category: CleanableCategory,
    /// Match type
    pub match_type: MatchType,
    /// User-friendly description
    pub description: &'static str,
    /// Whether this is a directory pattern
    pub is_dir: bool,
}

#[derive(Debug, Clone)]
pub enum MatchType {
    /// Exact directory/file name match
    Exact(&'static str),
    /// Suffix match (e.g., "*.log")
    Suffix(&'static str),
    /// Prefix match (e.g., "build*")
    Prefix(&'static str),
}

/// A detected cleanable item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanableItem {
    /// Full path to the item
    pub path: String,
    /// Item name
    pub name: String,
    /// Size in bytes
    pub size: u64,
    /// Category
    pub category: CleanableCategory,
    /// Whether it's a directory
    pub is_dir: bool,
    /// Pattern that matched
    pub pattern_name: String,
    /// Description
    pub description: String,
    /// Risk level (low, medium, high)
    pub risk_level: String,
    /// Number of files inside (for directories)
    pub file_count: u64,
}

/// Results of cleanable scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanableResult {
    /// All detected cleanable items
    pub items: Vec<CleanableItem>,
    /// Total size of all cleanable items
    pub total_size: u64,
    /// Size by category
    pub size_by_category: HashMap<String, u64>,
    /// Count by category
    pub count_by_category: HashMap<String, u64>,
    /// Scan duration in milliseconds
    pub duration_ms: u64,
    /// Total files scanned
    pub files_scanned: u64,
}

/// Progress event for cleanable scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanableProgress {
    pub phase: String,
    pub items_found: u64,
    pub total_size: u64,
    pub current_path: String,
    pub is_complete: bool,
}

/// Define all cleanable patterns
fn get_cleanable_patterns() -> Vec<CleanablePattern> {
    vec![
        // Dependencies
        CleanablePattern {
            name: "node_modules",
            category: CleanableCategory::Dependencies,
            match_type: MatchType::Exact("node_modules"),
            description: "Node.js dependencies (reinstall with npm/yarn/pnpm)",
            is_dir: true,
        },
        CleanablePattern {
            name: "vendor",
            category: CleanableCategory::Dependencies,
            match_type: MatchType::Exact("vendor"),
            description: "PHP/Go vendor dependencies",
            is_dir: true,
        },
        CleanablePattern {
            name: ".pnpm-store",
            category: CleanableCategory::Dependencies,
            match_type: MatchType::Exact(".pnpm-store"),
            description: "pnpm global store",
            is_dir: true,
        },
        CleanablePattern {
            name: "Pods",
            category: CleanableCategory::Dependencies,
            match_type: MatchType::Exact("Pods"),
            description: "CocoaPods dependencies",
            is_dir: true,
        },
        // Build output
        CleanablePattern {
            name: "dist",
            category: CleanableCategory::BuildOutput,
            match_type: MatchType::Exact("dist"),
            description: "Distribution/build output",
            is_dir: true,
        },
        CleanablePattern {
            name: "build",
            category: CleanableCategory::BuildOutput,
            match_type: MatchType::Exact("build"),
            description: "Build output directory",
            is_dir: true,
        },
        CleanablePattern {
            name: ".next",
            category: CleanableCategory::BuildOutput,
            match_type: MatchType::Exact(".next"),
            description: "Next.js build output",
            is_dir: true,
        },
        CleanablePattern {
            name: ".nuxt",
            category: CleanableCategory::BuildOutput,
            match_type: MatchType::Exact(".nuxt"),
            description: "Nuxt.js build output",
            is_dir: true,
        },
        CleanablePattern {
            name: ".output",
            category: CleanableCategory::BuildOutput,
            match_type: MatchType::Exact(".output"),
            description: "Nuxt 3 output directory",
            is_dir: true,
        },
        CleanablePattern {
            name: "target",
            category: CleanableCategory::BuildOutput,
            match_type: MatchType::Exact("target"),
            description: "Rust/Cargo build output",
            is_dir: true,
        },
        CleanablePattern {
            name: "out",
            category: CleanableCategory::BuildOutput,
            match_type: MatchType::Exact("out"),
            description: "Build output directory",
            is_dir: true,
        },
        // Caches
        CleanablePattern {
            name: ".cache",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".cache"),
            description: "General cache directory",
            is_dir: true,
        },
        CleanablePattern {
            name: "__pycache__",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact("__pycache__"),
            description: "Python bytecode cache",
            is_dir: true,
        },
        CleanablePattern {
            name: ".pytest_cache",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".pytest_cache"),
            description: "Pytest cache",
            is_dir: true,
        },
        CleanablePattern {
            name: ".mypy_cache",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".mypy_cache"),
            description: "MyPy type checker cache",
            is_dir: true,
        },
        CleanablePattern {
            name: ".ruff_cache",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".ruff_cache"),
            description: "Ruff linter cache",
            is_dir: true,
        },
        CleanablePattern {
            name: ".eslintcache",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".eslintcache"),
            description: "ESLint cache",
            is_dir: false,
        },
        CleanablePattern {
            name: ".parcel-cache",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".parcel-cache"),
            description: "Parcel bundler cache",
            is_dir: true,
        },
        CleanablePattern {
            name: ".turbo",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".turbo"),
            description: "Turborepo cache",
            is_dir: true,
        },
        CleanablePattern {
            name: ".gradle",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".gradle"),
            description: "Gradle cache",
            is_dir: true,
        },
        CleanablePattern {
            name: ".m2",
            category: CleanableCategory::Cache,
            match_type: MatchType::Exact(".m2"),
            description: "Maven repository cache",
            is_dir: true,
        },
        // Logs
        CleanablePattern {
            name: "*.log",
            category: CleanableCategory::Logs,
            match_type: MatchType::Suffix(".log"),
            description: "Log files",
            is_dir: false,
        },
        CleanablePattern {
            name: "logs",
            category: CleanableCategory::Logs,
            match_type: MatchType::Exact("logs"),
            description: "Log directory",
            is_dir: true,
        },
        CleanablePattern {
            name: "npm-debug.log*",
            category: CleanableCategory::Logs,
            match_type: MatchType::Prefix("npm-debug.log"),
            description: "npm debug logs",
            is_dir: false,
        },
        CleanablePattern {
            name: "yarn-debug.log*",
            category: CleanableCategory::Logs,
            match_type: MatchType::Prefix("yarn-debug.log"),
            description: "Yarn debug logs",
            is_dir: false,
        },
        CleanablePattern {
            name: "yarn-error.log*",
            category: CleanableCategory::Logs,
            match_type: MatchType::Prefix("yarn-error.log"),
            description: "Yarn error logs",
            is_dir: false,
        },
        // Temporary
        CleanablePattern {
            name: "tmp",
            category: CleanableCategory::Temporary,
            match_type: MatchType::Exact("tmp"),
            description: "Temporary directory",
            is_dir: true,
        },
        CleanablePattern {
            name: "temp",
            category: CleanableCategory::Temporary,
            match_type: MatchType::Exact("temp"),
            description: "Temporary directory",
            is_dir: true,
        },
        CleanablePattern {
            name: "*.tmp",
            category: CleanableCategory::Temporary,
            match_type: MatchType::Suffix(".tmp"),
            description: "Temporary files",
            is_dir: false,
        },
        CleanablePattern {
            name: "*.swp",
            category: CleanableCategory::Temporary,
            match_type: MatchType::Suffix(".swp"),
            description: "Vim swap files",
            is_dir: false,
        },
        CleanablePattern {
            name: "*.swo",
            category: CleanableCategory::Temporary,
            match_type: MatchType::Suffix(".swo"),
            description: "Vim swap files",
            is_dir: false,
        },
        CleanablePattern {
            name: "*~",
            category: CleanableCategory::Temporary,
            match_type: MatchType::Suffix("~"),
            description: "Backup files",
            is_dir: false,
        },
        // IDE files
        CleanablePattern {
            name: ".idea",
            category: CleanableCategory::IdeFiles,
            match_type: MatchType::Exact(".idea"),
            description: "JetBrains IDE settings",
            is_dir: true,
        },
        CleanablePattern {
            name: "*.iml",
            category: CleanableCategory::IdeFiles,
            match_type: MatchType::Suffix(".iml"),
            description: "IntelliJ module files",
            is_dir: false,
        },
        // System files
        CleanablePattern {
            name: ".DS_Store",
            category: CleanableCategory::SystemFiles,
            match_type: MatchType::Exact(".DS_Store"),
            description: "macOS folder metadata",
            is_dir: false,
        },
        CleanablePattern {
            name: "Thumbs.db",
            category: CleanableCategory::SystemFiles,
            match_type: MatchType::Exact("Thumbs.db"),
            description: "Windows thumbnail cache",
            is_dir: false,
        },
        CleanablePattern {
            name: "desktop.ini",
            category: CleanableCategory::SystemFiles,
            match_type: MatchType::Exact("desktop.ini"),
            description: "Windows folder settings",
            is_dir: false,
        },
    ]
}

/// Check if a file/directory name matches a pattern
fn matches_pattern(name: &str, pattern: &CleanablePattern) -> bool {
    match &pattern.match_type {
        MatchType::Exact(exact) => name == *exact,
        MatchType::Suffix(suffix) => name.ends_with(suffix),
        MatchType::Prefix(prefix) => name.starts_with(prefix),
    }
}

/// Calculate directory size recursively
fn calculate_dir_size(path: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut count = 0u64;

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                let (sub_size, sub_count) = calculate_dir_size(&entry_path);
                size += sub_size;
                count += sub_count;
            } else if let Ok(metadata) = entry.metadata() {
                size += metadata.len();
                count += 1;
            }
        }
    }

    (size, count)
}

/// Cleanable file finder with cancellation support
pub struct CleanableFinder {
    cancelled: AtomicBool,
    files_scanned: AtomicU64,
}

impl CleanableFinder {
    pub fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            files_scanned: AtomicU64::new(0),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn reset(&self) {
        self.cancelled.store(false, Ordering::SeqCst);
        self.files_scanned.store(0, Ordering::SeqCst);
    }

    pub fn find_cleanable(
        &self,
        root_path: &Path,
        app_handle: &AppHandle,
    ) -> Option<CleanableResult> {
        self.reset();
        let start_time = std::time::Instant::now();
        let patterns = get_cleanable_patterns();

        // Emit initial progress
        let _ = app_handle.emit(
            "cleanable-progress",
            CleanableProgress {
                phase: "scanning".to_string(),
                items_found: 0,
                total_size: 0,
                current_path: root_path.to_string_lossy().to_string(),
                is_complete: false,
            },
        );

        // Collect all directories to check
        let dirs_to_check = self.collect_directories(root_path, app_handle)?;

        // Check cancellation
        if self.cancelled.load(Ordering::SeqCst) {
            return None;
        }

        // Find cleanable items in parallel
        let items: Vec<CleanableItem> = dirs_to_check
            .par_iter()
            .filter_map(|dir_path| {
                if self.cancelled.load(Ordering::SeqCst) {
                    return None;
                }

                let name = dir_path.file_name()?.to_str()?;

                // Check against all patterns
                for pattern in &patterns {
                    if matches_pattern(name, pattern) {
                        let is_dir = dir_path.is_dir();
                        if pattern.is_dir != is_dir {
                            continue;
                        }

                        let (size, file_count) = if is_dir {
                            calculate_dir_size(dir_path)
                        } else {
                            let size = fs::metadata(dir_path).map(|m| m.len()).unwrap_or(0);
                            (size, 1)
                        };

                        return Some(CleanableItem {
                            path: dir_path.to_string_lossy().to_string(),
                            name: name.to_string(),
                            size,
                            category: pattern.category.clone(),
                            is_dir,
                            pattern_name: pattern.name.to_string(),
                            description: pattern.description.to_string(),
                            risk_level: pattern.category.risk_level().to_string(),
                            file_count,
                        });
                    }
                }

                None
            })
            .collect();

        // Check cancellation
        if self.cancelled.load(Ordering::SeqCst) {
            return None;
        }

        // Calculate totals
        let total_size: u64 = items.iter().map(|i| i.size).sum();
        let mut size_by_category: HashMap<String, u64> = HashMap::new();
        let mut count_by_category: HashMap<String, u64> = HashMap::new();

        for item in &items {
            let category_name = format!("{:?}", item.category).to_lowercase();
            *size_by_category.entry(category_name.clone()).or_insert(0) += item.size;
            *count_by_category.entry(category_name).or_insert(0) += 1;
        }

        // Emit completion
        let _ = app_handle.emit(
            "cleanable-progress",
            CleanableProgress {
                phase: "complete".to_string(),
                items_found: items.len() as u64,
                total_size,
                current_path: String::new(),
                is_complete: true,
            },
        );

        Some(CleanableResult {
            items,
            total_size,
            size_by_category,
            count_by_category,
            duration_ms: start_time.elapsed().as_millis() as u64,
            files_scanned: self.files_scanned.load(Ordering::SeqCst),
        })
    }

    /// Collect all files and directories to check
    fn collect_directories(&self, root: &Path, app_handle: &AppHandle) -> Option<Vec<PathBuf>> {
        let mut paths = Vec::new();
        let mut queue = vec![root.to_path_buf()];
        let patterns = get_cleanable_patterns();

        // Build a set of pattern names that are directories we should skip into
        let skip_dirs: std::collections::HashSet<&str> = patterns
            .iter()
            .filter(|p| p.is_dir)
            .filter_map(|p| match p.match_type {
                MatchType::Exact(name) => Some(name),
                _ => None,
            })
            .collect();

        while let Some(current) = queue.pop() {
            if self.cancelled.load(Ordering::SeqCst) {
                return None;
            }

            // Add current path to check
            paths.push(current.clone());

            // Read directory entries
            if let Ok(entries) = fs::read_dir(&current) {
                for entry in entries.flatten() {
                    self.files_scanned.fetch_add(1, Ordering::SeqCst);

                    let entry_path = entry.path();
                    let name = match entry_path.file_name().and_then(|n| n.to_str()) {
                        Some(n) => n,
                        None => continue,
                    };

                    // Add to paths to check
                    paths.push(entry_path.clone());

                    // If it's a directory, decide whether to descend into it
                    if entry_path.is_dir() {
                        // Don't descend into matched cleanable directories
                        // (we'll calculate their size separately)
                        if !skip_dirs.contains(name) {
                            queue.push(entry_path);
                        }
                    }

                    // Emit progress periodically
                    if self.files_scanned.load(Ordering::SeqCst) % 1000 == 0 {
                        let _ = app_handle.emit(
                            "cleanable-progress",
                            CleanableProgress {
                                phase: "scanning".to_string(),
                                items_found: 0,
                                total_size: 0,
                                current_path: current.to_string_lossy().to_string(),
                                is_complete: false,
                            },
                        );
                    }
                }
            }
        }

        Some(paths)
    }
}

impl Default for CleanableFinder {
    fn default() -> Self {
        Self::new()
    }
}
