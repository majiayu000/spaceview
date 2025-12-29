import React, { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  SnapshotEntry,
  SnapshotCompareResult,
  SnapshotFile,
  ChangedFile,
  formatSize,
  formatFullDate,
} from "./types";
import { useSettings } from "./contexts/SettingsContext";
import { useErrorNotification } from "./contexts/ErrorNotificationContext";

interface ScanComparePanelProps {
  scanPath: string;
  onClose: () => void;
}

type ComparePhase = "idle" | "loading" | "comparing" | "done";
type TabType = "added" | "removed" | "changed";

const ScanComparePanel: React.FC<ScanComparePanelProps> = ({
  scanPath,
  onClose,
}) => {
  const { settings } = useSettings();
  const { showError, showInfo } = useErrorNotification();

  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [selectedOld, setSelectedOld] = useState<number | null>(null);
  const [selectedNew, setSelectedNew] = useState<number | null>(null);
  const [phase, setPhase] = useState<ComparePhase>("idle");
  const [result, setResult] = useState<SnapshotCompareResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("added");

  const formatSizeWithUnit = useCallback(
    (bytes: number) => formatSize(bytes, settings.size_unit),
    [settings.size_unit]
  );

  // Load snapshots on mount
  useEffect(() => {
    const loadSnapshots = async () => {
      try {
        const list = await invoke<SnapshotEntry[]>("list_snapshots", {
          path: scanPath,
        });
        setSnapshots(list);
        // Auto-select the two most recent if available
        if (list.length >= 2) {
          setSelectedNew(list[0].timestamp);
          setSelectedOld(list[1].timestamp);
        } else if (list.length === 1) {
          setSelectedNew(list[0].timestamp);
        }
      } catch (e) {
        console.error("Failed to load snapshots:", e);
      }
    };
    loadSnapshots();
  }, [scanPath]);

  const handleSaveSnapshot = async () => {
    try {
      setPhase("loading");
      await invoke<string>("save_snapshot", { path: scanPath });
      showInfo("Snapshot saved successfully");
      // Reload snapshots
      const list = await invoke<SnapshotEntry[]>("list_snapshots", {
        path: scanPath,
      });
      setSnapshots(list);
      if (list.length >= 1) {
        setSelectedNew(list[0].timestamp);
        if (list.length >= 2) {
          setSelectedOld(list[1].timestamp);
        }
      }
    } catch (e) {
      showError(String(e));
    } finally {
      setPhase("idle");
    }
  };

  const handleCompare = async () => {
    if (!selectedOld || !selectedNew) {
      showError("Please select two snapshots to compare");
      return;
    }

    try {
      setPhase("comparing");
      const compareResult = await invoke<SnapshotCompareResult>(
        "compare_snapshots",
        {
          path: scanPath,
          oldTimestamp: selectedOld,
          newTimestamp: selectedNew,
        }
      );
      setResult(compareResult);
      setPhase("done");
    } catch (e) {
      showError(String(e));
      setPhase("idle");
    }
  };

  const handleDeleteSnapshot = async (timestamp: number) => {
    try {
      await invoke("delete_snapshot_cmd", { path: scanPath, timestamp });
      showInfo("Snapshot deleted");
      setSnapshots((prev) => prev.filter((s) => s.timestamp !== timestamp));
      if (selectedOld === timestamp) setSelectedOld(null);
      if (selectedNew === timestamp) setSelectedNew(null);
      if (result) setResult(null);
    } catch (e) {
      showError(String(e));
    }
  };

  const handleShowInFinder = async (path: string) => {
    try {
      await invoke("show_in_finder", { path });
    } catch (e) {
      console.error("Failed to show in Finder:", e);
    }
  };

  // Filter out directories for display (focus on files)
  const filteredAdded = useMemo(
    () => result?.added.filter((f) => !f.is_dir) || [],
    [result]
  );
  const filteredRemoved = useMemo(
    () => result?.removed.filter((f) => !f.is_dir) || [],
    [result]
  );
  const filteredChanged = useMemo(
    () => result?.changed.filter((f) => !f.is_dir) || [],
    [result]
  );

  const tabCounts = useMemo(
    () => ({
      added: filteredAdded.length,
      removed: filteredRemoved.length,
      changed: filteredChanged.length,
    }),
    [filteredAdded, filteredRemoved, filteredChanged]
  );

  return (
    <div className="scan-compare-overlay" onClick={onClose}>
      <div
        className="scan-compare-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-compare-title"
      >
        <div className="scan-compare-header">
          <h2 id="scan-compare-title">Compare Scan Snapshots</h2>
          <button
            className="close-btn"
            onClick={onClose}
            aria-label="Close panel"
          >
            &times;
          </button>
        </div>

        <div className="scan-compare-path">
          <span className="label">Path:</span>
          <span className="path">{scanPath}</span>
        </div>

        <div className="scan-compare-content">
          {/* Snapshot Selection */}
          <div className="snapshot-selection">
            <div className="snapshot-actions">
              <button
                className="save-snapshot-btn"
                onClick={handleSaveSnapshot}
                disabled={phase === "loading" || phase === "comparing"}
              >
                {phase === "loading" ? "Saving..." : "Save Current Snapshot"}
              </button>
              <span className="snapshot-count">
                {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}{" "}
                available
              </span>
            </div>

            {snapshots.length < 2 && (
              <div className="snapshot-hint">
                <p>
                  {snapshots.length === 0
                    ? "No snapshots yet. Save a snapshot after scanning to enable comparison."
                    : "Save at least one more snapshot to compare changes over time."}
                </p>
              </div>
            )}

            {snapshots.length >= 2 && (
              <div className="snapshot-selectors">
                <div className="selector-group">
                  <label>Older Snapshot (Before)</label>
                  <select
                    value={selectedOld ?? ""}
                    onChange={(e) =>
                      setSelectedOld(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Select snapshot...</option>
                    {snapshots
                      .filter((s) => s.timestamp !== selectedNew)
                      .map((s) => (
                        <option key={s.timestamp} value={s.timestamp}>
                          {formatFullDate(s.timestamp)} ({formatSizeWithUnit(s.total_size)})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="selector-arrow">→</div>

                <div className="selector-group">
                  <label>Newer Snapshot (After)</label>
                  <select
                    value={selectedNew ?? ""}
                    onChange={(e) =>
                      setSelectedNew(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Select snapshot...</option>
                    {snapshots
                      .filter((s) => s.timestamp !== selectedOld)
                      .map((s) => (
                        <option key={s.timestamp} value={s.timestamp}>
                          {formatFullDate(s.timestamp)} ({formatSizeWithUnit(s.total_size)})
                        </option>
                      ))}
                  </select>
                </div>

                <button
                  className="compare-btn"
                  onClick={handleCompare}
                  disabled={!selectedOld || !selectedNew || phase === "comparing"}
                >
                  {phase === "comparing" ? "Comparing..." : "Compare"}
                </button>
              </div>
            )}

            {/* Snapshot list for management */}
            {snapshots.length > 0 && (
              <div className="snapshot-list">
                <h3>All Snapshots</h3>
                <div className="snapshot-items">
                  {snapshots.map((s) => (
                    <div key={s.timestamp} className="snapshot-item">
                      <div className="snapshot-info">
                        <span className="snapshot-date">
                          {formatFullDate(s.timestamp)}
                        </span>
                        <span className="snapshot-stats">
                          {s.total_files.toLocaleString()} files,{" "}
                          {formatSizeWithUnit(s.total_size)}
                        </span>
                      </div>
                      <button
                        className="delete-snapshot-btn"
                        onClick={() => handleDeleteSnapshot(s.timestamp)}
                        title="Delete snapshot"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Comparison Results */}
          {result && (
            <div className="compare-results">
              <div className="compare-summary">
                <div className="summary-item added">
                  <span className="icon">+</span>
                  <span className="count">{tabCounts.added}</span>
                  <span className="label">Added</span>
                  <span className="size">+{formatSizeWithUnit(result.added_size)}</span>
                </div>
                <div className="summary-item removed">
                  <span className="icon">−</span>
                  <span className="count">{tabCounts.removed}</span>
                  <span className="label">Removed</span>
                  <span className="size">−{formatSizeWithUnit(result.removed_size)}</span>
                </div>
                <div className="summary-item changed">
                  <span className="icon">~</span>
                  <span className="count">{tabCounts.changed}</span>
                  <span className="label">Changed</span>
                </div>
                <div
                  className={`summary-item net ${
                    result.net_size_change >= 0 ? "positive" : "negative"
                  }`}
                >
                  <span className="icon">=</span>
                  <span className="label">Net Change</span>
                  <span className="size">
                    {result.net_size_change >= 0 ? "+" : ""}
                    {formatSizeWithUnit(Math.abs(result.net_size_change))}
                  </span>
                </div>
              </div>

              <div className="compare-tabs">
                <button
                  className={`tab ${activeTab === "added" ? "active" : ""}`}
                  onClick={() => setActiveTab("added")}
                >
                  Added ({tabCounts.added})
                </button>
                <button
                  className={`tab ${activeTab === "removed" ? "active" : ""}`}
                  onClick={() => setActiveTab("removed")}
                >
                  Removed ({tabCounts.removed})
                </button>
                <button
                  className={`tab ${activeTab === "changed" ? "active" : ""}`}
                  onClick={() => setActiveTab("changed")}
                >
                  Changed ({tabCounts.changed})
                </button>
              </div>

              <div className="compare-list">
                {activeTab === "added" && (
                  <FileList
                    files={filteredAdded}
                    type="added"
                    formatSize={formatSizeWithUnit}
                    onShowInFinder={handleShowInFinder}
                    scanPath={scanPath}
                  />
                )}
                {activeTab === "removed" && (
                  <FileList
                    files={filteredRemoved}
                    type="removed"
                    formatSize={formatSizeWithUnit}
                    onShowInFinder={handleShowInFinder}
                    scanPath={scanPath}
                  />
                )}
                {activeTab === "changed" && (
                  <ChangedFileList
                    files={filteredChanged}
                    formatSize={formatSizeWithUnit}
                    onShowInFinder={handleShowInFinder}
                    scanPath={scanPath}
                  />
                )}
              </div>

              <div className="compare-footer">
                <span className="unchanged">
                  {result.unchanged_count.toLocaleString()} unchanged items
                </span>
                <span className="time">Compared in {result.time_ms}ms</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// File list component for added/removed files
interface FileListProps {
  files: SnapshotFile[];
  type: "added" | "removed";
  formatSize: (bytes: number) => string;
  onShowInFinder: (path: string) => void;
  scanPath: string;
}

const FileList: React.FC<FileListProps> = ({
  files,
  type,
  formatSize,
  onShowInFinder,
  scanPath,
}) => {
  if (files.length === 0) {
    return (
      <div className="empty-list">
        No {type === "added" ? "new" : "deleted"} files
      </div>
    );
  }

  return (
    <div className="file-list">
      {files.slice(0, 100).map((file, idx) => (
        <div key={idx} className={`file-item ${type}`}>
          <span className="file-icon">{type === "added" ? "+" : "−"}</span>
          <div className="file-info">
            <span className="file-name">{file.name}</span>
            <span className="file-path">{file.path}</span>
          </div>
          <span className="file-size">{formatSize(file.size)}</span>
          {type === "added" && (
            <button
              className="show-in-finder-btn"
              onClick={() => onShowInFinder(`${scanPath}/${file.path}`)}
              title="Show in Finder"
            >
              ↗
            </button>
          )}
        </div>
      ))}
      {files.length > 100 && (
        <div className="more-items">
          ...and {files.length - 100} more files
        </div>
      )}
    </div>
  );
};

// Changed files list component
interface ChangedFileListProps {
  files: ChangedFile[];
  formatSize: (bytes: number) => string;
  onShowInFinder: (path: string) => void;
  scanPath: string;
}

const ChangedFileList: React.FC<ChangedFileListProps> = ({
  files,
  formatSize,
  onShowInFinder,
  scanPath,
}) => {
  if (files.length === 0) {
    return <div className="empty-list">No files changed size</div>;
  }

  return (
    <div className="file-list">
      {files.slice(0, 100).map((file, idx) => (
        <div key={idx} className="file-item changed">
          <span
            className={`file-icon ${file.size_diff >= 0 ? "grew" : "shrunk"}`}
          >
            {file.size_diff >= 0 ? "↑" : "↓"}
          </span>
          <div className="file-info">
            <span className="file-name">{file.name}</span>
            <span className="file-path">{file.path}</span>
          </div>
          <div className="size-change">
            <span className="old-size">{formatSize(file.old_size)}</span>
            <span className="arrow">→</span>
            <span className="new-size">{formatSize(file.new_size)}</span>
            <span
              className={`diff ${file.size_diff >= 0 ? "positive" : "negative"}`}
            >
              ({file.size_diff >= 0 ? "+" : ""}
              {formatSize(Math.abs(file.size_diff))})
            </span>
          </div>
          <button
            className="show-in-finder-btn"
            onClick={() => onShowInFinder(`${scanPath}/${file.path}`)}
            title="Show in Finder"
          >
            ↗
          </button>
        </div>
      ))}
      {files.length > 100 && (
        <div className="more-items">
          ...and {files.length - 100} more files
        </div>
      )}
    </div>
  );
};

export default ScanComparePanel;
