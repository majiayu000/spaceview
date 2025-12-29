//! Performance benchmark for scanner
//! Run: cargo run --release --bin bench

use ignore::{WalkBuilder, WalkState};
use parking_lot::RwLock;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const HASH_SAMPLE_SIZE: u64 = 64 * 1024;

fn main() {
    println!("\n{}", "=".repeat(70));
    println!("SpaceView Scanner Performance Benchmark");
    println!("{}", "=".repeat(70));

    let test_paths = vec![
        "/Users/lifcc/Desktop/code/OpenSource/SpaceView/src",
        "/Users/lifcc/Desktop/code/OpenSource/SpaceView/src-tauri/src",
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
    println!("Benchmarking: hashing overhead");
    println!("{}", "=".repeat(70));
    benchmark_hashing();

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
    #[allow(clippy::type_complexity)]
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
                    .or_default()
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

fn benchmark_hashing() {
    let dir = make_temp_dir("spaceview-hash-bench");
    let file_count = 20usize;
    let file_size = 1usize * 1024 * 1024;
    let files = write_test_files(&dir, file_count, file_size);

    println!("  Files: {}, Size: {:.2} MB", file_count, file_size as f64 / 1_048_576.0);

    let start_partial = Instant::now();
    for path in &files {
        let _ = compute_partial_hash(path, file_size as u64);
    }
    let partial_time = start_partial.elapsed();
    println!("  Partial hash time: {:?}", partial_time);

    let start_full = Instant::now();
    for path in &files {
        let _ = compute_full_hash(path);
    }
    let full_time = start_full.elapsed();
    println!("  Full hash time: {:?}", full_time);

    println!(
        "  Partial+Full overhead: {:.1}%",
        (partial_time + full_time).as_secs_f64() / partial_time.as_secs_f64() * 100.0 - 100.0
    );

    let _ = fs::remove_dir_all(dir);
}

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

fn write_test_files(dir: &Path, count: usize, size: usize) -> Vec<PathBuf> {
    let mut files = Vec::with_capacity(count);
    let mut buffer = vec![0u8; size];
    for i in 0..count {
        buffer.fill((i % 251) as u8);
        let path = dir.join(format!("file-{}.bin", i));
        let mut file = File::create(&path).unwrap();
        file.write_all(&buffer).unwrap();
        files.push(path);
    }
    files
}

fn compute_partial_hash(path: &Path, size: u64) -> Option<String> {
    if size <= HASH_SAMPLE_SIZE * 2 {
        return compute_full_hash(path);
    }

    let file = File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file);
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
    let mut reader = std::io::BufReader::new(file);
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
