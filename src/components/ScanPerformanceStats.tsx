import React, { useState, useEffect } from "react";
import { ScanProgress } from "../types";

interface ScanPerformanceStatsProps {
  startTime: number;
  progress: ScanProgress;
}

// Format elapsed time in human-readable format
function formatElapsed(ms: number): string {
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

export const ScanPerformanceStats = React.memo(function ScanPerformanceStats({
  startTime,
  progress,
}: ScanPerformanceStatsProps) {
  const [now, setNow] = useState(Date.now());

  // Update every second
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = now - startTime;
  const elapsedSeconds = elapsed / 1000;
  const filesPerSecond = elapsedSeconds > 0 ? progress.scanned_files / elapsedSeconds : 0;
  const throughput = elapsedSeconds > 0 ? progress.total_size / elapsedSeconds : 0;

  return (
    <div className="scanning-performance">
      <div className="scanning-perf-stat">
        <span className="scanning-perf-icon">⏱️</span>
        <span className="scanning-perf-value">{formatElapsed(elapsed)}</span>
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
  );
});
