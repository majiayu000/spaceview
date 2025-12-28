//! Performance benchmark for scanner
//! Run: cargo run --release --bin bench

use ignore::{WalkBuilder, WalkState};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

fn main() {
    println!("\n{}", "=".repeat(70));
    println!("SpaceView Scanner Performance Benchmark");
    println!("{}", "=".repeat(70));

    let test_paths = vec![
        "/Users/lifcc/Desktop/code",
        "/usr/local",
    ];

    for path in &test_paths {
        if Path::new(path).exists() {
            println!("\n\n{}", "=".repeat(70));
            println!("Benchmarking: {}", path);
            println!("{}", "=".repeat(70));
            benchmark_path(path);
        }
    }

    println!("\n\n{}", "=".repeat(70));
    println!("Benchmark Complete!");
    println!("{}", "=".repeat(70));
}

fn benchmark_path(path: &str) {
    let num_threads = num_cpus::get();
    println!("Using {} threads", num_threads);

    // Phase 1: Walk only (no data collection)
    println!("\n[Test 1] Walk only (count files)...");
    let start = Instant::now();
    let files = Arc::new(AtomicU64::new(0));
    let dirs = Arc::new(AtomicU64::new(0));
    let total_size = Arc::new(AtomicU64::new(0));

    let walker = WalkBuilder::new(path)
        .hidden(false)
        .ignore(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .follow_links(false)
        .threads(num_threads)
        .build_parallel();

    let f = files.clone();
    let d = dirs.clone();
    let s = total_size.clone();

    walker.run(|| {
        let files = f.clone();
        let dirs = d.clone();
        let size = s.clone();

        Box::new(move |entry| {
            if let Ok(e) = entry {
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if is_dir {
                    dirs.fetch_add(1, Ordering::Relaxed);
                } else {
                    files.fetch_add(1, Ordering::Relaxed);
                    if let Ok(meta) = e.metadata() {
                        size.fetch_add(meta.len(), Ordering::Relaxed);
                    }
                }
            }
            WalkState::Continue
        })
    });

    let walk_time = start.elapsed();
    let fc = files.load(Ordering::Relaxed);
    let dc = dirs.load(Ordering::Relaxed);
    let sz = total_size.load(Ordering::Relaxed);

    println!("  Walk time: {:?}", walk_time);
    println!("  Files: {}, Dirs: {}", fc, dc);
    println!("  Size: {:.2} GB", sz as f64 / 1_073_741_824.0);
    println!("  Speed: {:.0} files/sec", fc as f64 / walk_time.as_secs_f64());

    // Phase 2: Walk + HashMap insert
    println!("\n[Test 2] Walk + HashMap insert...");
    let start2 = Instant::now();
    let nodes: Arc<RwLock<HashMap<PathBuf, (String, u64, bool)>>> =
        Arc::new(RwLock::new(HashMap::with_capacity(100_000)));

    let walker2 = WalkBuilder::new(path)
        .hidden(false)
        .ignore(false)
        .git_ignore(false)
        .threads(num_threads)
        .build_parallel();

    let n = nodes.clone();

    walker2.run(|| {
        let nodes = n.clone();

        Box::new(move |entry| {
            if let Ok(e) = entry {
                let path = e.path().to_path_buf();
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let size = if is_dir { 0 } else { e.metadata().map(|m| m.len()).unwrap_or(0) };
                let name = path.file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

                nodes.write().insert(path, (name, size, is_dir));
            }
            WalkState::Continue
        })
    });

    let map_time = start2.elapsed();
    let node_count = nodes.read().len();
    println!("  Walk+Map time: {:?}", map_time);
    println!("  Nodes in map: {}", node_count);
    println!("  Overhead vs walk: {:.1}%",
        (map_time.as_secs_f64() - walk_time.as_secs_f64()) / walk_time.as_secs_f64() * 100.0);

    // Phase 3: Build relationships
    println!("\n[Test 3] Building parent-child relationships...");
    let start3 = Instant::now();
    let mut relationships: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    {
        let map = nodes.read();
        for path in map.keys() {
            if let Some(parent) = path.parent() {
                relationships.entry(parent.to_path_buf())
                    .or_insert_with(Vec::new)
                    .push(path.clone());
            }
        }
    }
    let rel_time = start3.elapsed();
    println!("  Relationship time: {:?}", rel_time);
    println!("  Parent nodes: {}", relationships.len());

    // Summary
    let total_time = walk_time + map_time + rel_time;
    println!("\n{}", "-".repeat(50));
    println!("SUMMARY:");
    println!("  Total time:    {:?}", total_time);
    println!("  Walk:          {:?} ({:.1}%)", walk_time, walk_time.as_secs_f64() / total_time.as_secs_f64() * 100.0);
    println!("  HashMap:       {:?} ({:.1}%)", map_time - walk_time,
        (map_time.as_secs_f64() - walk_time.as_secs_f64()) / total_time.as_secs_f64() * 100.0);
    println!("  Relationships: {:?} ({:.1}%)", rel_time, rel_time.as_secs_f64() / total_time.as_secs_f64() * 100.0);
    println!("{}", "-".repeat(50));
}
