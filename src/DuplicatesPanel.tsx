import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  DuplicateResult,
  DuplicateProgress,
  DuplicateGroup,
  formatSize,
} from "./types";
import { useErrorNotification, useSettings } from "./contexts";

interface DuplicatesPanelProps {
  scanPath: string;
  onClose: () => void;
  onShowInFinder: (path: string) => void;
}

export function DuplicatesPanel({
  scanPath,
  onClose,
  onShowInFinder,
}: DuplicatesPanelProps) {
  const { showError } = useErrorNotification();
  const { settings } = useSettings();

  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<DuplicateProgress | null>(null);
  const [result, setResult] = useState<DuplicateResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [minSize, setMinSize] = useState<number>(1024 * 1024); // 1MB default
  const initializedRef = useRef(false);

  // Apply settings on first render
  useEffect(() => {
    if (!initializedRef.current) {
      setMinSize(settings.duplicate_min_size);
      initializedRef.current = true;
    }
  }, [settings.duplicate_min_size]);

  // Create size formatter with current settings
  const formatSizeWithUnit = useCallback((bytes: number) => {
    return formatSize(bytes, settings.size_unit);
  }, [settings.size_unit]);

  useEffect(() => {
    let unlistenProgress: UnlistenFn | undefined;

    const setup = async () => {
      unlistenProgress = await listen<DuplicateProgress>(
        "duplicate-progress",
        (event) => {
          setProgress(event.payload);
          if (event.payload.is_complete) {
            setIsScanning(false);
          }
        }
      );
    };

    setup();

    return () => {
      unlistenProgress?.();
    };
  }, []);

  const startScan = async () => {
    setIsScanning(true);
    setResult(null);
    setProgress(null);
    setExpandedGroups(new Set());

    try {
      const duplicates = await invoke<DuplicateResult | null>("find_duplicates", {
        path: scanPath,
        minSize: minSize,
      });
      if (duplicates) {
        setResult(duplicates);
      }
    } catch (err) {
      showError(`Duplicate scan failed: ${err}`);
    } finally {
      setIsScanning(false);
    }
  };

  const cancelScan = async () => {
    await invoke("cancel_duplicate_scan");
    setIsScanning(false);
  };

  const toggleGroup = (hash: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  };

  const getPhaseLabel = (phase: string): string => {
    switch (phase) {
      case "scanning":
        return "Scanning files...";
      case "grouping":
        return "Grouping by size...";
      case "hashing":
        return "Computing file hashes...";
      case "complete":
        return "Complete";
      default:
        return phase;
    }
  };

  return (
    <div className="duplicates-panel">
      <div className="duplicates-header">
        <h3>Duplicate Files</h3>
        <button className="close-btn" onClick={onClose} title="Close">
          x
        </button>
      </div>

      <div className="duplicates-controls">
        <div className="min-size-control">
          <label>Min size:</label>
          <select
            value={minSize}
            onChange={(e) => setMinSize(Number(e.target.value))}
            disabled={isScanning}
          >
            <option value={1024}>1 KB</option>
            <option value={1024 * 10}>10 KB</option>
            <option value={1024 * 100}>100 KB</option>
            <option value={1024 * 1024}>1 MB</option>
            <option value={1024 * 1024 * 10}>10 MB</option>
            <option value={1024 * 1024 * 100}>100 MB</option>
          </select>
        </div>
        {!isScanning ? (
          <button className="scan-btn" onClick={startScan}>
            Find Duplicates
          </button>
        ) : (
          <button className="cancel-btn" onClick={cancelScan}>
            Cancel
          </button>
        )}
      </div>

      {progress && isScanning && (
        <div className="duplicates-progress">
          <div className="progress-phase">{getPhaseLabel(progress.phase)}</div>
          {progress.phase === "hashing" && progress.total_to_hash > 0 && (
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{
                  width: `${(progress.files_hashed / progress.total_to_hash) * 100}%`,
                }}
              />
            </div>
          )}
          <div className="progress-stats">
            {progress.phase === "scanning" && (
              <span>Scanned: {progress.scanned_files.toLocaleString()} files</span>
            )}
            {progress.phase === "grouping" && (
              <span>Found: {progress.groups_found.toLocaleString()} size groups</span>
            )}
            {progress.phase === "hashing" && (
              <span>
                Hashed: {progress.files_hashed.toLocaleString()} /{" "}
                {progress.total_to_hash.toLocaleString()}
              </span>
            )}
          </div>
          {progress.current_file && (
            <div className="progress-current" title={progress.current_file}>
              {progress.current_file.length > 50
                ? "..." + progress.current_file.slice(-47)
                : progress.current_file}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="duplicates-result">
          <div className="result-summary">
            <div className="summary-item">
              <span className="summary-label">Groups:</span>
              <span className="summary-value">{result.groups.length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Files:</span>
              <span className="summary-value">{result.total_duplicates}</span>
            </div>
            <div className="summary-item wasted">
              <span className="summary-label">Wasted:</span>
              <span className="summary-value">
                {formatSizeWithUnit(result.total_wasted_bytes)}
              </span>
            </div>
            {result.partial_collision_groups > 0 && (
              <div className="summary-item">
                <span className="summary-label">Partial collisions:</span>
                <span className="summary-value">
                  {result.partial_collision_groups.toLocaleString()}
                </span>
              </div>
            )}
            {result.full_hash_files > 0 && (
              <div className="summary-item">
                <span className="summary-label">Full-hashed files:</span>
                <span className="summary-value">
                  {result.full_hash_files.toLocaleString()}
                </span>
              </div>
            )}
            <div className="summary-item">
              <span className="summary-label">Time:</span>
              <span className="summary-value">{(result.time_ms / 1000).toFixed(1)}s</span>
            </div>
          </div>

          {result.groups.length === 0 ? (
            <div className="no-duplicates">No duplicate files found!</div>
          ) : (
            <div className="duplicates-list">
              {result.groups.map((group: DuplicateGroup) => (
                <div key={group.hash} className="duplicate-group">
                  <div
                    className="group-header"
                    onClick={() => toggleGroup(group.hash)}
                  >
                    <span className="expand-icon">
                      {expandedGroups.has(group.hash) ? "v" : ">"}
                    </span>
                    <span className="group-count">{group.files.length}x</span>
                    <span className="group-size">{formatSizeWithUnit(group.size)}</span>
                    <span className="group-wasted">
                      (-{formatSizeWithUnit(group.wasted_bytes)})
                    </span>
                    <span className="group-name" title={group.files[0]?.name}>
                      {group.files[0]?.name}
                    </span>
                  </div>
                  {expandedGroups.has(group.hash) && (
                    <div className="group-files">
                      {group.files.map((file, idx) => (
                        <div key={idx} className="file-item">
                          <span className="file-path" title={file.path}>
                            {file.path}
                          </span>
                          <button
                            className="show-btn"
                            onClick={() => onShowInFinder(file.path)}
                            title="Show in Finder"
                          >
                            Show
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isScanning && !result && (
        <div className="duplicates-intro">
          <p>Find files with identical content in the scanned directory.</p>
          <p>
            Files are compared by size first, then by content hash (SHA-256) to ensure
            accurate detection.
          </p>
        </div>
      )}
    </div>
  );
}
