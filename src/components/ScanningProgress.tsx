import React, { useState, useEffect } from "react";
import { ScanProgress, formatSize } from "../types";

interface ScanningProgressProps {
  progress: ScanProgress | null;
  startTime: number | null;  // Unix timestamp when scanning started
  onCancel: () => void;
}

interface PerformanceStats {
  elapsedTime: number;
  filesPerSecond: number;
  throughput: number;
}

// Format elapsed time in human-readable format
function formatElapsedTime(ms: number): string {
  if (ms < 1000) return "< 1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

// Format speed (files per second)
function formatSpeed(filesPerSecond: number): string {
  if (filesPerSecond < 1) return "< 1";
  if (filesPerSecond < 1000) return filesPerSecond.toFixed(0);
  return `${(filesPerSecond / 1000).toFixed(1)}k`;
}

// Format throughput (bytes per second)
function formatThroughput(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const k = 1024;
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  return `${(bytesPerSecond / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export const ScanningProgress = React.memo(function ScanningProgress({
  progress,
  startTime,
  onCancel,
}: ScanningProgressProps) {
  // Performance stats updated every second
  const [stats, setStats] = useState<PerformanceStats>({
    elapsedTime: 0,
    filesPerSecond: 0,
    throughput: 0,
  });

  // Update stats every second
  useEffect(() => {
    if (!startTime || !progress) {
      setStats({ elapsedTime: 0, filesPerSecond: 0, throughput: 0 });
      return;
    }

    const updateStats = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const elapsedSeconds = elapsed / 1000;

      setStats({
        elapsedTime: elapsed,
        filesPerSecond: elapsedSeconds > 0 ? progress.scanned_files / elapsedSeconds : 0,
        throughput: elapsedSeconds > 0 ? progress.total_size / elapsedSeconds : 0,
      });
    };

    // Initial update
    updateStats();

    // Update every second
    const intervalId = setInterval(updateStats, 1000);

    return () => clearInterval(intervalId);
  }, [startTime, progress]);

  const { elapsedTime, filesPerSecond, throughput } = stats;

  return (
    <div className="scanning" role="status" aria-live="polite">
      <div className="scanning-spinner" aria-hidden="true">
        <div className="spinner-ring" />
      </div>
      <h2>Scanning Directory</h2>
      <p className="scanning-subtitle">
        {progress?.phase === "walking" && "Scanning files..."}
        {progress?.phase === "relations" && "Building relationships..."}
        {progress?.phase === "sizes" && "Calculating sizes..."}
        {progress?.phase === "tree" && "Building visualization..."}
        {!progress?.phase && "Analyzing file structure..."}
      </p>

      <div className="scanning-progress">
        <div className="scanning-progress-bar scanning-progress-indeterminate" />
      </div>

      <div className="scanning-stats-grid">
        <div className="scanning-stat">
          <span className="scanning-stat-value">
            {(progress?.scanned_files ?? 0).toLocaleString()}
          </span>
          <span className="scanning-stat-label">Files</span>
        </div>
        <div className="scanning-stat">
          <span className="scanning-stat-value">
            {(progress?.scanned_dirs ?? 0).toLocaleString()}
          </span>
          <span className="scanning-stat-label">Folders</span>
        </div>
        <div className="scanning-stat">
          <span className="scanning-stat-value">
            {formatSize(progress?.total_size ?? 0)}
          </span>
          <span className="scanning-stat-label">Total Size</span>
        </div>
      </div>

      {/* Performance stats row */}
      {startTime && progress && (
        <div className="scanning-performance">
          <div className="scanning-perf-stat">
            <span className="scanning-perf-icon">⏱️</span>
            <span className="scanning-perf-value">{formatElapsedTime(elapsedTime)}</span>
            <span className="scanning-perf-label">Elapsed</span>
          </div>
          <div className="scanning-perf-stat">
            <span className="scanning-perf-icon">⚡</span>
            <span className="scanning-perf-value">{formatSpeed(filesPerSecond)}</span>
            <span className="scanning-perf-label">files/sec</span>
          </div>
          <div className="scanning-perf-stat">
            <span className="scanning-perf-icon">📊</span>
            <span className="scanning-perf-value">{formatThroughput(throughput)}</span>
            <span className="scanning-perf-label">throughput</span>
          </div>
        </div>
      )}

      {progress?.current_path && (
        <div className="scanning-path">
          <span className="scanning-path-label">Current:</span>
          <span className="scanning-path-value">{progress.current_path}</span>
        </div>
      )}

      <button
        className="scanning-cancel-btn"
        onClick={onCancel}
        aria-label="Cancel scanning"
      >
        Cancel Scan
      </button>
    </div>
  );
});
