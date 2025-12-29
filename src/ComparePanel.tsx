import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  CompareResult,
  CompareProgress,
  CompareFile,
  DiffFile,
  formatSize,
} from "./types";
import { useErrorNotification } from "./contexts";

interface ComparePanelProps {
  initialPath?: string;
  onClose: () => void;
  onShowInFinder: (path: string) => void;
}

type TabType = "left_only" | "right_only" | "different";

export function ComparePanel({
  initialPath,
  onClose,
  onShowInFinder,
}: ComparePanelProps) {
  const { showError, showWarning } = useErrorNotification();
  const [leftPath, setLeftPath] = useState<string>(initialPath || "");
  const [rightPath, setRightPath] = useState<string>("");
  const [isComparing, setIsComparing] = useState(false);
  const [progress, setProgress] = useState<CompareProgress | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("left_only");

  useEffect(() => {
    let unlistenProgress: UnlistenFn | undefined;

    const setup = async () => {
      unlistenProgress = await listen<CompareProgress>(
        "compare-progress",
        (event) => {
          setProgress(event.payload);
          if (event.payload.is_complete) {
            setIsComparing(false);
          }
        }
      );
    };

    setup();

    return () => {
      unlistenProgress?.();
    };
  }, []);

  const selectFolder = async (side: "left" | "right") => {
    try {
      const path = await invoke<string | null>("open_folder_dialog");
      if (path) {
        if (side === "left") {
          setLeftPath(path);
        } else {
          setRightPath(path);
        }
      }
    } catch (err) {
      showWarning(`Failed to open folder: ${err}`);
    }
  };

  const startCompare = async () => {
    if (!leftPath || !rightPath) return;

    setIsComparing(true);
    setResult(null);
    setProgress(null);

    try {
      const compareResult = await invoke<CompareResult | null>("compare_directories", {
        leftPath,
        rightPath,
      });
      if (compareResult) {
        setResult(compareResult);
        // Switch to the tab with the most items
        if (compareResult.left_only.length >= compareResult.right_only.length &&
            compareResult.left_only.length >= compareResult.different.length) {
          setActiveTab("left_only");
        } else if (compareResult.right_only.length >= compareResult.different.length) {
          setActiveTab("right_only");
        } else {
          setActiveTab("different");
        }
      }
    } catch (err) {
      showError(`Compare failed: ${err}`);
    } finally {
      setIsComparing(false);
    }
  };

  const cancelCompare = async () => {
    await invoke("cancel_compare");
    setIsComparing(false);
  };

  const getPhaseLabel = (phase: string): string => {
    switch (phase) {
      case "scanning_left":
        return "Scanning left directory...";
      case "scanning_right":
        return "Scanning right directory...";
      case "comparing":
        return "Comparing files...";
      case "complete":
        return "Complete";
      default:
        return phase;
    }
  };

  const truncatePath = (path: string, maxLen: number = 40): string => {
    if (path.length <= maxLen) return path;
    return "..." + path.slice(-maxLen + 3);
  };

  const renderFileList = (files: CompareFile[], _side: "left" | "right") => {
    if (files.length === 0) {
      return <div className="compare-empty">No files found</div>;
    }

    return (
      <div className="compare-file-list">
        {files.map((file, idx) => (
          <div key={idx} className={`compare-file-item ${file.is_dir ? "is-dir" : ""}`}>
            <span className="file-icon">{file.is_dir ? "📁" : "📄"}</span>
            <div className="file-info">
              <span className="file-name" title={file.name}>
                {file.name}
              </span>
              <span className="file-path" title={file.relative_path}>
                {truncatePath(file.relative_path)}
              </span>
            </div>
            <span className="file-size">{file.is_dir ? "-" : formatSize(file.size)}</span>
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
    );
  };

  const renderDiffList = (files: DiffFile[]) => {
    if (files.length === 0) {
      return <div className="compare-empty">No different files found</div>;
    }

    return (
      <div className="compare-file-list diff-list">
        {files.map((file, idx) => (
          <div key={idx} className="compare-file-item diff-item">
            <span className="file-icon">
              {file.left_is_dir || file.right_is_dir
                ? (file.left_is_dir && file.right_is_dir ? "📁" : "📁/📄")
                : "📄"}
            </span>
            <div className="file-info">
              <span className="file-name" title={file.name}>
                {file.name}
              </span>
              <span className="file-path" title={file.relative_path}>
                {truncatePath(file.relative_path)}
              </span>
            </div>
            <div className="diff-sizes">
              <span className="left-size" title="Left size">
                {file.left_is_dir ? "-" : formatSize(file.left_size)}
              </span>
              <span className="size-arrow">→</span>
              <span className="right-size" title="Right size">
                {file.right_is_dir ? "-" : formatSize(file.right_size)}
              </span>
              {file.left_is_dir !== file.right_is_dir ? (
                <span className="size-diff">Type conflict</span>
              ) : (
                <span className={`size-diff ${file.right_size > file.left_size ? "increase" : "decrease"}`}>
                  ({file.right_size > file.left_size ? "+" : ""}{formatSize(Math.abs(file.right_size - file.left_size))})
                </span>
              )}
            </div>
            <div className="diff-actions">
              <button
                className="show-btn"
                onClick={() => onShowInFinder(file.left_path)}
                title="Show left in Finder"
              >
                L
              </button>
              <button
                className="show-btn"
                onClick={() => onShowInFinder(file.right_path)}
                title="Show right in Finder"
              >
                R
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="compare-panel">
      <div className="compare-header">
        <h3>Compare Directories</h3>
        <button className="close-btn" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      <div className="compare-folder-select">
        <div className="folder-row">
          <span className="folder-label">Left:</span>
          <div className="folder-path" title={leftPath}>
            {leftPath ? truncatePath(leftPath, 35) : "Select folder..."}
          </div>
          <button
            className="folder-btn"
            onClick={() => selectFolder("left")}
            disabled={isComparing}
          >
            Browse
          </button>
        </div>
        <div className="folder-row">
          <span className="folder-label">Right:</span>
          <div className="folder-path" title={rightPath}>
            {rightPath ? truncatePath(rightPath, 35) : "Select folder..."}
          </div>
          <button
            className="folder-btn"
            onClick={() => selectFolder("right")}
            disabled={isComparing}
          >
            Browse
          </button>
        </div>
      </div>

      <div className="compare-actions">
        {!isComparing ? (
          <button
            className="compare-btn"
            onClick={startCompare}
            disabled={!leftPath || !rightPath}
          >
            Compare Directories
          </button>
        ) : (
          <button className="cancel-btn" onClick={cancelCompare}>
            Cancel
          </button>
        )}
      </div>

      {progress && isComparing && (
        <div className="compare-progress">
          <div className="progress-phase">{getPhaseLabel(progress.phase)}</div>
          {progress.phase === "comparing" && progress.total_to_compare > 0 && (
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{
                  width: `${(progress.compared_files / progress.total_to_compare) * 100}%`,
                }}
              />
            </div>
          )}
          <div className="progress-stats">
            {progress.phase === "scanning_left" && (
              <span>Files: {progress.left_files.toLocaleString()}</span>
            )}
            {progress.phase === "scanning_right" && (
              <span>
                Left: {progress.left_files.toLocaleString()} | Right: {progress.right_files.toLocaleString()}
              </span>
            )}
            {progress.phase === "comparing" && (
              <span>
                Common compared: {progress.compared_files.toLocaleString()} / {progress.total_to_compare.toLocaleString()}
              </span>
            )}
          </div>
          {progress.current_file && (
            <div className="progress-current" title={progress.current_file}>
              {truncatePath(progress.current_file, 50)}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="compare-result">
          <div className="result-summary">
            <div className="summary-item">
              <span className="summary-label">Left only:</span>
              <span className="summary-value">{result.left_only.length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Right only:</span>
              <span className="summary-value">{result.right_only.length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Different:</span>
              <span className="summary-value">{result.different.length}</span>
            </div>
            {result.type_conflict_count > 0 && (
              <div className="summary-item">
                <span className="summary-label">Type conflicts:</span>
                <span className="summary-value">
                  {result.type_conflict_count.toLocaleString()}
                  {result.type_conflict_size > 0 && (
                    <span className="summary-subvalue">
                      {" "}({formatSize(result.type_conflict_size)})
                    </span>
                  )}
                </span>
              </div>
            )}
            <div className="summary-item identical">
              <span className="summary-label">Identical:</span>
              <span className="summary-value">{result.identical_count}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Time:</span>
              <span className="summary-value">{(result.time_ms / 1000).toFixed(1)}s</span>
            </div>
          </div>

          <div className="compare-tabs">
            <button
              className={`tab-btn ${activeTab === "left_only" ? "active" : ""}`}
              onClick={() => setActiveTab("left_only")}
            >
              Left Only ({result.left_only.length})
              {result.left_only_size > 0 && (
                <span className="tab-size">{formatSize(result.left_only_size)}</span>
              )}
            </button>
            <button
              className={`tab-btn ${activeTab === "right_only" ? "active" : ""}`}
              onClick={() => setActiveTab("right_only")}
            >
              Right Only ({result.right_only.length})
              {result.right_only_size > 0 && (
                <span className="tab-size">{formatSize(result.right_only_size)}</span>
              )}
            </button>
            <button
              className={`tab-btn ${activeTab === "different" ? "active" : ""}`}
              onClick={() => setActiveTab("different")}
            >
              Different ({result.different.length})
            </button>
          </div>

          <div className="compare-content">
            {activeTab === "left_only" && renderFileList(result.left_only, "left")}
            {activeTab === "right_only" && renderFileList(result.right_only, "right")}
            {activeTab === "different" && renderDiffList(result.different)}
          </div>
        </div>
      )}

      {!isComparing && !result && (
        <div className="compare-intro">
          <p>Compare two directories to find differences.</p>
          <p>
            Identifies files that exist only in one directory, and files that
            exist in both but have different content.
          </p>
        </div>
      )}
    </div>
  );
}
