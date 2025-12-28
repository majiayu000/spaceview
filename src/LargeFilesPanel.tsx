import React, { useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FileNode,
  formatSize,
  getFileIcon,
  getFileType,
  FILE_TYPE_COLORS,
} from "./types";

interface LargeFilesPanelProps {
  rootNode: FileNode | null;
  onNavigateToFile?: (filePath: string) => void;
}

interface LargeFile {
  node: FileNode;
  percentage: number;
}

export const LargeFilesPanel = React.memo(function LargeFilesPanel({
  rootNode,
  onNavigateToFile,
}: LargeFilesPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCount, setShowCount] = useState(10);

  // Recursively collect all files (non-directories)
  const collectFiles = useCallback((node: FileNode, files: FileNode[]) => {
    if (!node.is_dir) {
      files.push(node);
    } else {
      for (const child of node.children) {
        collectFiles(child, files);
      }
    }
  }, []);

  // Get largest files sorted by size
  const largestFiles = useMemo<LargeFile[]>(() => {
    if (!rootNode) return [];

    const files: FileNode[] = [];
    collectFiles(rootNode, files);

    // Sort by size descending
    files.sort((a, b) => b.size - a.size);

    // Calculate percentage and return top N
    const totalSize = rootNode.size || 1;
    return files.slice(0, showCount).map((node) => ({
      node,
      percentage: (node.size / totalSize) * 100,
    }));
  }, [rootNode, showCount, collectFiles]);

  const handleShowInFinder = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("show_in_finder", { path });
    } catch (err) {
      console.error("Failed to show in Finder:", err);
    }
  };

  const handleFileClick = (file: LargeFile) => {
    if (onNavigateToFile) {
      onNavigateToFile(file.node.path);
    }
  };

  if (!rootNode || largestFiles.length === 0) {
    return null;
  }

  // Get summary stats
  const topFilesSize = largestFiles.reduce((sum, f) => sum + f.node.size, 0);
  const topFilesPercentage = ((topFilesSize / rootNode.size) * 100).toFixed(1);

  return (
    <div className={`large-files-panel${isExpanded ? " expanded" : ""}`}>
      <button
        className="large-files-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="large-files-list"
      >
        <div className="large-files-title">
          <span className="large-files-icon">📊</span>
          <span>Top {showCount} Largest Files</span>
          <span className="large-files-summary">
            {formatSize(topFilesSize)} ({topFilesPercentage}%)
          </span>
        </div>
        <span className={`large-files-chevron${isExpanded ? " rotated" : ""}`}>
          ▼
        </span>
      </button>

      {isExpanded && (
        <div id="large-files-list" className="large-files-list">
          {/* Show count selector */}
          <div className="large-files-controls">
            <span className="large-files-controls-label">Show top:</span>
            {[10, 20, 50, 100].map((count) => (
              <button
                key={count}
                className={`large-files-count-btn${showCount === count ? " active" : ""}`}
                onClick={() => setShowCount(count)}
              >
                {count}
              </button>
            ))}
          </div>

          {/* File list */}
          <div className="large-files-items">
            {largestFiles.map((file, index) => (
              <div
                key={file.node.id}
                className="large-file-item"
                onClick={() => handleFileClick(file)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && handleFileClick(file)}
              >
                <span className="large-file-rank">#{index + 1}</span>
                <span
                  className="large-file-icon"
                  style={{ color: FILE_TYPE_COLORS[getFileType(file.node)] }}
                >
                  {getFileIcon(file.node)}
                </span>
                <div className="large-file-info">
                  <div className="large-file-name" title={file.node.name}>
                    {file.node.name}
                  </div>
                  <div className="large-file-path" title={file.node.path}>
                    {file.node.path}
                  </div>
                </div>
                <div className="large-file-size-info">
                  <div className="large-file-size">
                    {formatSize(file.node.size)}
                  </div>
                  <div className="large-file-percent">
                    {file.percentage.toFixed(1)}%
                  </div>
                </div>
                <button
                  className="large-file-finder-btn"
                  onClick={(e) => handleShowInFinder(file.node.path, e)}
                  title="Show in Finder"
                  aria-label={`Show ${file.node.name} in Finder`}
                >
                  📂
                </button>
                {/* Size bar visualization */}
                <div
                  className="large-file-bar"
                  style={{
                    width: `${file.percentage}%`,
                    background: FILE_TYPE_COLORS[getFileType(file.node)],
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
