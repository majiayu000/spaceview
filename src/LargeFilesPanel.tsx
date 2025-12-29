import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FileNode,
  formatSize,
  getFileIcon,
  getFileType,
  FILE_TYPE_COLORS,
} from "./types";
import { useErrorNotification, useSettings } from "./contexts";

interface LargeFilesPanelProps {
  rootNode: FileNode | null;
  onNavigateToFile?: (filePath: string) => void;
}

interface LargeFile {
  node: FileNode;
  percentage: number;
}

type SortField = "size" | "name" | "modified";
type SortDirection = "asc" | "desc";

interface SortOption {
  field: SortField;
  direction: SortDirection;
  label: string;
  icon: string;
}

const SORT_OPTIONS: SortOption[] = [
  { field: "size", direction: "desc", label: "Size (Largest)", icon: "📏↓" },
  { field: "size", direction: "asc", label: "Size (Smallest)", icon: "📏↑" },
  { field: "name", direction: "asc", label: "Name (A-Z)", icon: "🔤↓" },
  { field: "name", direction: "desc", label: "Name (Z-A)", icon: "🔤↑" },
  { field: "modified", direction: "desc", label: "Modified (Newest)", icon: "📅↓" },
  { field: "modified", direction: "asc", label: "Modified (Oldest)", icon: "📅↑" },
];

export const LargeFilesPanel = React.memo(function LargeFilesPanel({
  rootNode,
  onNavigateToFile,
}: LargeFilesPanelProps) {
  const { showWarning } = useErrorNotification();
  const { settings } = useSettings();

  // Initialize state from settings
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCount, setShowCount] = useState(20);
  const [sortField, setSortField] = useState<SortField>("size");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // Apply settings on first render (using ref to track initialization)
  useEffect(() => {
    if (!initializedRef.current) {
      setIsExpanded(settings.auto_expand_large_files);
      setShowCount(settings.large_files_count);
      initializedRef.current = true;
    }
  }, [settings.auto_expand_large_files, settings.large_files_count]);

  // Create size formatter with current settings
  const formatSizeWithUnit = useCallback((bytes: number) => {
    return formatSize(bytes, settings.size_unit);
  }, [settings.size_unit]);

  // Close sort menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    if (showSortMenu) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [showSortMenu]);

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

  // Sort comparator based on field and direction
  const sortComparator = useCallback((a: FileNode, b: FileNode): number => {
    let cmp = 0;
    switch (sortField) {
      case "size":
        cmp = a.size - b.size;
        break;
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        break;
      case "modified":
        cmp = (a.modified_at || 0) - (b.modified_at || 0);
        break;
    }
    return sortDirection === "desc" ? -cmp : cmp;
  }, [sortField, sortDirection]);

  // Get files sorted by selected criteria
  const sortedFiles = useMemo<LargeFile[]>(() => {
    if (!rootNode) return [];

    const files: FileNode[] = [];
    collectFiles(rootNode, files);

    // Sort by selected criteria
    files.sort(sortComparator);

    // Calculate percentage and return top N
    const totalSize = rootNode.size || 1;
    return files.slice(0, showCount).map((node) => ({
      node,
      percentage: (node.size / totalSize) * 100,
    }));
  }, [rootNode, showCount, collectFiles, sortComparator]);

  // Get current sort option
  const currentSortOption = SORT_OPTIONS.find(
    (opt) => opt.field === sortField && opt.direction === sortDirection
  );

  // Handle sort selection
  const handleSortSelect = (opt: SortOption) => {
    setSortField(opt.field);
    setSortDirection(opt.direction);
    setShowSortMenu(false);
  };

  const handleShowInFinder = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("show_in_finder", { path });
    } catch (err) {
      showWarning(`Failed to show in Finder: ${err}`);
    }
  };

  const handleFileClick = (file: LargeFile) => {
    if (onNavigateToFile) {
      onNavigateToFile(file.node.path);
    }
  };

  if (!rootNode || sortedFiles.length === 0) {
    return null;
  }

  // Get summary stats
  const topFilesSize = sortedFiles.reduce((sum, f) => sum + f.node.size, 0);
  const topFilesPercentage = ((topFilesSize / rootNode.size) * 100).toFixed(1);

  // Dynamic panel title based on sort
  const panelTitle = sortField === "size" && sortDirection === "desc"
    ? `Top ${showCount} Largest Files`
    : `Top ${showCount} Files`;

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
          <span>{panelTitle}</span>
          <span className="large-files-summary">
            {formatSizeWithUnit(topFilesSize)} ({topFilesPercentage}%)
          </span>
        </div>
        <span className={`large-files-chevron${isExpanded ? " rotated" : ""}`}>
          ▼
        </span>
      </button>

      {isExpanded && (
        <div id="large-files-list" className="large-files-list">
          {/* Controls row */}
          <div className="large-files-controls">
            {/* Show count selector */}
            <div className="large-files-control-group">
              <span className="large-files-controls-label">Show:</span>
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

            {/* Sort selector */}
            <div className="large-files-control-group">
              <span className="large-files-controls-label">Sort:</span>
              <div className="large-files-sort-dropdown" ref={sortDropdownRef}>
                <button
                  className="large-files-sort-btn"
                  onClick={() => setShowSortMenu(!showSortMenu)}
                  aria-haspopup="listbox"
                  aria-expanded={showSortMenu}
                >
                  <span className="sort-icon">{currentSortOption?.icon}</span>
                  <span className="sort-label">{currentSortOption?.label}</span>
                  <span className="sort-chevron">▼</span>
                </button>
                {showSortMenu && (
                  <div className="large-files-sort-menu" role="listbox">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={`${opt.field}-${opt.direction}`}
                        className={`large-files-sort-option${
                          sortField === opt.field && sortDirection === opt.direction ? " active" : ""
                        }`}
                        onClick={() => handleSortSelect(opt)}
                        role="option"
                        aria-selected={sortField === opt.field && sortDirection === opt.direction}
                      >
                        <span className="sort-icon">{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* File list */}
          <div className="large-files-items">
            {sortedFiles.map((file, index) => (
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
                    {formatSizeWithUnit(file.node.size)}
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
