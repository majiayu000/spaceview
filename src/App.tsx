import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FileNode,
  ScanProgress,
  DiskSpaceInfo,
  TreemapRect,
  FileType,
  CachedScan,
  ScanHistoryEntry,
  FILE_TYPE_COLORS,
  FILE_TYPE_NAMES,
  getFileGradient,
  getFileIcon,
  getFileType,
  formatSize,
  formatDate,
} from "./types";
import { layoutTreemap } from "./treemap";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { FileTypeChart } from "./FileTypeChart";

// Memoized container cell component to prevent re-renders
const TreemapContainerCell = React.memo(function TreemapContainerCell({
  rect,
  isSelected,
  onHover,
  onLeave,
  onNavigate,
  onContextMenu,
  onSelect,
}: {
  rect: TreemapRect;
  isSelected: boolean;
  onHover: (node: FileNode, e: React.MouseEvent) => void;
  onLeave: () => void;
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={`treemap-container-cell depth-${rect.depth}${isSelected ? " selected" : ""}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
      onMouseEnter={(e) => onHover(rect.node, e)}
      onMouseMove={(e) => onHover(rect.node, e)}
      onMouseLeave={onLeave}
      onClick={onSelect}
      onDoubleClick={() => onNavigate(rect.node)}
      onContextMenu={(e) => onContextMenu(e, rect.node)}
    >
      {rect.height > 50 && (
        <div className="treemap-container-header">
          <span className="treemap-container-name">{rect.node.name}</span>
          <span className="treemap-container-size">{formatSize(rect.node.size)}</span>
        </div>
      )}
    </div>
  );
});

// Memoized leaf cell component to prevent re-renders
const TreemapLeafCell = React.memo(function TreemapLeafCell({
  rect,
  isSelected,
  onHover,
  onLeave,
  onNavigate,
  onContextMenu,
  onSelect,
}: {
  rect: TreemapRect;
  isSelected: boolean;
  onHover: (node: FileNode, e: React.MouseEvent) => void;
  onLeave: () => void;
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onSelect: () => void;
}) {
  const isMoreItems = rect.node.name.startsWith("<") && rect.node.name.includes("more items");

  const handleClick = () => {
    onSelect();
    if (isMoreItems) {
      onNavigate(rect.node);
    }
  };

  return (
    <div
      className={`treemap-cell depth-${rect.depth}${isMoreItems ? " more-items-cell" : ""}${isSelected ? " selected" : ""}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: isMoreItems
          ? "linear-gradient(135deg, #4b5563 0%, #374151 100%)"
          : getFileGradient(rect.node),
      }}
      onMouseEnter={(e) => onHover(rect.node, e)}
      onMouseMove={(e) => onHover(rect.node, e)}
      onMouseLeave={onLeave}
      onClick={handleClick}
      onDoubleClick={isMoreItems ? undefined : () => onNavigate(rect.node)}
      onContextMenu={(e) => onContextMenu(e, rect.node)}
    >
      {rect.width > 50 && rect.height > 35 && (
        <>
          {rect.height > 60 && (
            <div className="treemap-cell-icon">
              {isMoreItems ? "📂" : getFileIcon(rect.node)}
            </div>
          )}
          <div className="treemap-cell-name">
            {isMoreItems ? "Click to expand" : rect.node.name}
          </div>
          <div className="treemap-cell-size">
            {isMoreItems ? rect.node.name.replace("<", "").replace(">", "") : formatSize(rect.node.size)}
          </div>
        </>
      )}
    </div>
  );
});

interface ErrorNotification {
  id: number;
  message: string;
  type: 'error' | 'warning';
}

function App() {
  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [currentNode, setCurrentNode] = useState<FileNode | null>(null);
  const [navigationPath, setNavigationPath] = useState<FileNode[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [hoveredNode, setHoveredNode] = useState<FileNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [filterType, setFilterType] = useState<FileType | null>(null);
  const [searchText, setSearchText] = useState("");
  const [minSizeFilter, setMinSizeFilter] = useState<number>(0); // in bytes
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode;
  } | null>(null);
  const [treemapRects, setTreemapRects] = useState<TreemapRect[]>([]);
  const [diskInfo, setDiskInfo] = useState<DiskSpaceInfo | null>(null);
  const [errors, setErrors] = useState<ErrorNotification[]>([]);
  const [isFromCache, setIsFromCache] = useState(false);
  const [cacheTime, setCacheTime] = useState<number | null>(null);
  const [currentScanPath, setCurrentScanPath] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const errorIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load scan history on mount
  useEffect(() => {
    invoke<ScanHistoryEntry[]>("get_scan_history").then(setScanHistory).catch(console.error);
  }, []);

  const showError = useCallback((message: string, type: 'error' | 'warning' = 'error') => {
    const id = ++errorIdRef.current;
    setErrors(prev => [...prev, { id, message, type }]);
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setErrors(prev => prev.filter(e => e.id !== id));
    }, 5000);
  }, []);

  const dismissError = useCallback((id: number) => {
    setErrors(prev => prev.filter(e => e.id !== id));
  }, []);

  // Listen for scan progress events
  useEffect(() => {
    const unlistenProgress = listen<ScanProgress>("scan-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.is_complete) {
        setIsScanning(false);
        setIsFromCache(false);
      }
    });

    // Listen for cache-loaded events
    const unlistenCache = listen<CachedScan>("scan-from-cache", (event) => {
      console.log("[Cache] Loaded from cache:", event.payload.scanned_at);
      setIsFromCache(true);
      setCacheTime(event.payload.scanned_at);
      setIsScanning(false);
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenCache.then((fn) => fn());
    };
  }, []);

  // Update treemap layout when current node or container size changes
  useEffect(() => {
    if (!currentNode || !containerRef.current) return;

    const container = containerRef.current;
    const bounds = {
      x: 0,
      y: 0,
      width: container.clientWidth,
      height: container.clientHeight,
    };

    const rects = layoutTreemap(currentNode, bounds);
    setTreemapRects(rects);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      const newBounds = {
        x: 0,
        y: 0,
        width: container.clientWidth,
        height: container.clientHeight,
      };
      setTreemapRects(layoutTreemap(currentNode, newBounds));
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [currentNode]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const handleOpenFolder = async () => {
    try {
      // First open folder dialog using frontend API
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select folder to analyze",
      });

      if (!selectedPath) return;

      await scanPath(selectedPath, false);
    } catch (error) {
      showError(`Scan failed: ${error}`);
      setIsScanning(false);
    }
  };

  const scanPath = async (path: string, forceRescan = false) => {
    try {
      setCurrentScanPath(path);

      // Fetch disk info for the selected path
      try {
        const info = await invoke<DiskSpaceInfo>("get_disk_info", { path });
        setDiskInfo(info);
      } catch (e) {
        showError(`Failed to get disk info: ${e}`, 'warning');
      }

      // Start scanning (use_cache: false to force rescan)
      setIsScanning(true);
      setProgress(null);
      const result = await invoke<FileNode | null>("scan_directory", {
        path,
        use_cache: !forceRescan,
      });
      if (result) {
        setRootNode(result);
        setCurrentNode(result);
        setNavigationPath([]);
      }
      setIsScanning(false);
    } catch (error) {
      showError(`Scan failed: ${error}`);
      setIsScanning(false);
    }
  };

  const handleRefreshScan = async () => {
    if (currentScanPath) {
      setIsFromCache(false);
      setCacheTime(null);
      await scanPath(currentScanPath, true);
    }
  };

  const handleCancelScan = async () => {
    await invoke("cancel_scan");
    setIsScanning(false);
  };

  // Export scan results
  const exportAsJSON = useCallback(() => {
    if (!rootNode) return;

    const data = {
      scanPath: rootNode.path,
      exportedAt: new Date().toISOString(),
      totalSize: rootNode.size,
      totalFiles: rootNode.file_count,
      totalDirs: rootNode.dir_count,
      tree: rootNode,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spaceview-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rootNode]);

  const exportAsCSV = useCallback(() => {
    if (!rootNode) return;

    const rows: string[] = ["Path,Name,Type,Size (bytes),Size (human),Is Directory,File Count,Dir Count"];

    const collectRows = (node: FileNode, depth = 0) => {
      const type = getFileType(node);
      rows.push([
        `"${node.path.replace(/"/g, '""')}"`,
        `"${node.name.replace(/"/g, '""')}"`,
        type,
        node.size.toString(),
        formatSize(node.size),
        node.is_dir ? "Yes" : "No",
        node.file_count.toString(),
        node.dir_count.toString(),
      ].join(","));

      if (depth < 5) { // Limit depth for CSV export
        node.children.forEach(child => collectRows(child, depth + 1));
      }
    };

    collectRows(rootNode);

    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spaceview-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rootNode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+O / Ctrl+O to open folder
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        if (!isScanning) {
          handleOpenFolder();
        }
        return;
      }

      // Don't handle navigation keys if scanning or no treemap
      if (isScanning || filteredRects.length === 0) return;

      // Escape - close menus and deselect
      if (e.key === 'Escape') {
        setContextMenu(null);
        setShowFilterMenu(false);
        setSelectedIndex(-1);
        return;
      }

      // Backspace - go back in navigation
      if (e.key === 'Backspace' && navigationPath.length > 0) {
        e.preventDefault();
        navigateToIndex(navigationPath.length - 2);
        setSelectedIndex(-1);
        return;
      }

      // Enter - navigate into selected item
      if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < filteredRects.length) {
        e.preventDefault();
        navigateTo(filteredRects[selectedIndex].node);
        setSelectedIndex(-1);
        return;
      }

      // Arrow keys - navigate between cells
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();

        if (selectedIndex < 0) {
          // No selection, select the largest (first) item
          setSelectedIndex(0);
          return;
        }

        const currentRect = filteredRects[selectedIndex];
        const cx = currentRect.x + currentRect.width / 2;
        const cy = currentRect.y + currentRect.height / 2;

        let bestIndex = selectedIndex;
        let bestDistance = Infinity;

        filteredRects.forEach((rect, i) => {
          if (i === selectedIndex) return;

          const rx = rect.x + rect.width / 2;
          const ry = rect.y + rect.height / 2;
          const dx = rx - cx;
          const dy = ry - cy;

          // Check direction
          let isValidDirection = false;
          if (e.key === 'ArrowUp' && dy < -10) isValidDirection = true;
          if (e.key === 'ArrowDown' && dy > 10) isValidDirection = true;
          if (e.key === 'ArrowLeft' && dx < -10) isValidDirection = true;
          if (e.key === 'ArrowRight' && dx > 10) isValidDirection = true;

          if (isValidDirection) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestIndex = i;
            }
          }
        });

        setSelectedIndex(bestIndex);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isScanning, filteredRects, selectedIndex, navigationPath, navigateTo, navigateToIndex]);

  // Zoom with mouse wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.min(Math.max(prev * delta, 0.5), 4));
    }
  }, []);

  // Pan with mouse drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) { // Middle click or Alt+click
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Reset zoom and pan
  const resetZoomPan = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Reset zoom/pan when navigating
  useEffect(() => {
    resetZoomPan();
  }, [currentNode, resetZoomPan]);

  // Find a node by path in the tree
  const findNodeByPath = useCallback((root: FileNode | null, path: string): FileNode | null => {
    if (!root) return null;
    if (root.path === path) return root;
    for (const child of root.children) {
      const found = findNodeByPath(child, path);
      if (found) return found;
    }
    return null;
  }, []);

  const navigateTo = useCallback(
    (node: FileNode) => {
      // Handle "<N more items>" placeholder - navigate to parent folder
      if (node.name.startsWith("<") && node.name.includes("more items")) {
        // The path points to the parent directory
        const parentNode = findNodeByPath(rootNode, node.path);
        if (parentNode && parentNode.children.length > 0) {
          setNavigationPath((prev) => [...prev, parentNode]);
          setCurrentNode(parentNode);
        }
        return;
      }

      // Only navigate into directories that have children
      if (node.is_dir && node.children.length > 0) {
        setNavigationPath((prev) => [...prev, node]);
        setCurrentNode(node);
      }
    },
    [rootNode, findNodeByPath]
  );

  const navigateToIndex = useCallback(
    (index: number) => {
      if (index === -1) {
        // Navigate to root
        setNavigationPath([]);
        setCurrentNode(rootNode);
      } else {
        setNavigationPath((prev) => prev.slice(0, index + 1));
        setCurrentNode(navigationPath[index]);
      }
    },
    [rootNode, navigationPath]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: FileNode) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    []
  );

  const handleShowInFinder = async (path: string) => {
    try {
      await invoke("show_in_finder", { path });
    } catch (e) {
      showError(`Failed to show in Finder: ${e}`);
    }
    setContextMenu(null);
  };

  const handleOpenFile = async (path: string) => {
    try {
      await invoke("open_file", { path });
    } catch (e) {
      showError(`Failed to open file: ${e}`);
    }
    setContextMenu(null);
  };

  const handleMoveToTrash = async (path: string) => {
    try {
      await invoke("move_to_trash", { path });
      setContextMenu(null);
      // Rescan to update
      if (rootNode) {
        setIsScanning(true);
        const result = await invoke<FileNode | null>("scan_directory", {
          path: rootNode.path,
        });
        if (result) {
          setRootNode(result);
          setCurrentNode(result);
          setNavigationPath([]);
        }
        setIsScanning(false);
      }
    } catch (e) {
      showError(`Failed to move to trash: ${e}`);
      setContextMenu(null);
    }
  };

  // Filter rects - memoized to avoid recalculation on every render
  const filteredRects = useMemo(() => {
    const lowerSearchText = searchText.toLowerCase();
    return treemapRects.filter((rect) => {
      if (filterType && getFileType(rect.node) !== filterType) return false;
      if (searchText && !rect.node.name.toLowerCase().includes(lowerSearchText)) {
        return false;
      }
      if (minSizeFilter > 0 && rect.node.size < minSizeFilter) return false;
      return true;
    });
  }, [treemapRects, filterType, searchText, minSizeFilter]);

  // Jump to largest item
  const jumpToLargest = useCallback(() => {
    if (filteredRects.length > 0) {
      // Find the largest item (excluding containers at depth 0)
      const largestIdx = filteredRects.reduce((maxIdx, rect, idx, arr) => {
        if (rect.isContainer && rect.depth === 0) return maxIdx;
        return rect.node.size > arr[maxIdx].node.size ? idx : maxIdx;
      }, 0);
      setSelectedIndex(largestIdx);
    }
  }, [filteredRects]);

  // Stable callbacks for memoized treemap cells
  const handleCellHover = useCallback((node: FileNode, e: React.MouseEvent) => {
    setHoveredNode(node);
    setTooltipPos({ x: e.clientX + 16, y: e.clientY + 16 });
  }, []);

  const handleCellLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

  // Format cache time as relative string
  const formatCacheTime = (timestamp: number): string => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString();
  };

  return (
    <>
      {/* Toolbar */}
      <div className="toolbar" role="toolbar" aria-label="Main toolbar">
        <button
          className="toolbar-btn"
          onClick={handleOpenFolder}
          disabled={isScanning}
          aria-label="Open folder to analyze"
        >
          <span aria-hidden="true">&#128193;</span> Open Folder
        </button>

        {isScanning && (
          <button
            className="toolbar-btn"
            onClick={handleCancelScan}
            aria-label="Cancel current scan"
          >
            <span aria-hidden="true">&#10005;</span> Cancel
          </button>
        )}

        {rootNode && !isScanning && (
          <button
            className="toolbar-btn"
            onClick={handleRefreshScan}
            aria-label="Refresh scan (ignore cache)"
            title="Force rescan without using cache"
          >
            <span aria-hidden="true">&#x21bb;</span> Refresh
          </button>
        )}

        {isFromCache && cacheTime && (
          <div className="cache-indicator" title="Data loaded from cache">
            <span className="cache-icon">⚡</span>
            <span className="cache-text">
              Cached {formatCacheTime(cacheTime)}
            </span>
          </div>
        )}

        <div className="toolbar-divider" />

        <div className="filter-menu">
          <button
            className="filter-btn"
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            aria-haspopup="listbox"
            aria-expanded={showFilterMenu}
            aria-label={`Filter by file type: ${filterType ? FILE_TYPE_NAMES[filterType] : 'All types'}`}
          >
            {filterType ? (
              <>
                <span
                  className="filter-dot"
                  style={{ background: FILE_TYPE_COLORS[filterType] }}
                  aria-hidden="true"
                />
                {FILE_TYPE_NAMES[filterType]}
              </>
            ) : (
              <>
                <span aria-hidden="true">&#9662;</span> Filter
              </>
            )}
          </button>

          {showFilterMenu && (
            <div className="filter-dropdown" role="listbox" aria-label="File type filter">
              <div
                className="filter-option"
                role="option"
                aria-selected={filterType === null}
                tabIndex={0}
                onClick={() => {
                  setFilterType(null);
                  setShowFilterMenu(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (setFilterType(null), setShowFilterMenu(false))}
              >
                All Types
              </div>
              {(Object.keys(FILE_TYPE_COLORS) as FileType[]).map((type) => (
                <div
                  key={type}
                  className="filter-option"
                  role="option"
                  aria-selected={filterType === type}
                  tabIndex={0}
                  onClick={() => {
                    setFilterType(type);
                    setShowFilterMenu(false);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (setFilterType(type), setShowFilterMenu(false))}
                >
                  <span
                    className="filter-dot"
                    style={{ background: FILE_TYPE_COLORS[type] }}
                    aria-hidden="true"
                  />
                  {FILE_TYPE_NAMES[type]}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick size filters */}
        {rootNode && !isScanning && (
          <div className="size-filters">
            <button
              className={`size-filter-btn${minSizeFilter === 0 ? " active" : ""}`}
              onClick={() => setMinSizeFilter(0)}
            >
              All
            </button>
            <button
              className={`size-filter-btn${minSizeFilter === 100 * 1024 * 1024 ? " active" : ""}`}
              onClick={() => setMinSizeFilter(100 * 1024 * 1024)}
            >
              &gt;100MB
            </button>
            <button
              className={`size-filter-btn${minSizeFilter === 1024 * 1024 * 1024 ? " active" : ""}`}
              onClick={() => setMinSizeFilter(1024 * 1024 * 1024)}
            >
              &gt;1GB
            </button>
            <button
              className={`size-filter-btn${minSizeFilter === 10 * 1024 * 1024 * 1024 ? " active" : ""}`}
              onClick={() => setMinSizeFilter(10 * 1024 * 1024 * 1024)}
            >
              &gt;10GB
            </button>
          </div>
        )}

        {/* Jump to largest */}
        {rootNode && !isScanning && (
          <button
            className="toolbar-btn jump-largest-btn"
            onClick={jumpToLargest}
            title="Jump to largest item (select it)"
          >
            <span aria-hidden="true">🎯</span> Largest
          </button>
        )}

        {/* Export buttons */}
        {rootNode && !isScanning && (
          <div className="export-buttons">
            <button
              className="toolbar-btn export-btn"
              onClick={exportAsJSON}
              title="Export scan results as JSON"
            >
              <span aria-hidden="true">📥</span> JSON
            </button>
            <button
              className="toolbar-btn export-btn"
              onClick={exportAsCSV}
              title="Export scan results as CSV"
            >
              <span aria-hidden="true">📊</span> CSV
            </button>
          </div>
        )}

        <div className="search-box">
          <span aria-hidden="true">&#128269;</span>
          <label htmlFor="file-search" className="visually-hidden">Search files</label>
          <input
            id="file-search"
            type="text"
            placeholder="Search files..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            aria-label="Search files by name"
          />
          {searchText && (
            <button
              className="search-clear"
              onClick={() => setSearchText("")}
              aria-label="Clear search"
              style={{ cursor: "pointer", background: "none", border: "none", color: "inherit" }}
            >
              &#10005;
            </button>
          )}
        </div>

        <ThemeSwitcher />
      </div>

      {/* Breadcrumb */}
      {rootNode && (
        <nav className="breadcrumb" aria-label="Folder navigation">
          <button
            className={`breadcrumb-item ${navigationPath.length === 0 ? "active" : ""}`}
            onClick={() => navigateToIndex(-1)}
            aria-current={navigationPath.length === 0 ? "location" : undefined}
          >
            <span aria-hidden="true">&#128193;</span> {rootNode.name}
          </button>
          {navigationPath.map((node, index) => (
            <span key={node.id}>
              <span className="breadcrumb-separator" aria-hidden="true">&#8250;</span>
              <button
                className={`breadcrumb-item ${index === navigationPath.length - 1 ? "active" : ""}`}
                onClick={() => navigateToIndex(index)}
                aria-current={index === navigationPath.length - 1 ? "location" : undefined}
              >
                <span aria-hidden="true">&#128193;</span> {node.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {/* Disk Overview Bar */}
      {rootNode && diskInfo && !isScanning && (
        <div className="disk-overview">
          <div className="disk-overview-bar">
            <div
              className="disk-overview-used"
              style={{ width: `${(diskInfo.used_bytes / diskInfo.total_bytes) * 100}%` }}
            >
              <div
                className="disk-overview-scanned"
                style={{ width: `${(rootNode.size / diskInfo.used_bytes) * 100}%` }}
              />
            </div>
          </div>
          <div className="disk-overview-stats">
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Disk Total</span>
              <span className="disk-overview-value">{formatSize(diskInfo.total_bytes)}</span>
            </div>
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Disk Used</span>
              <span className="disk-overview-value disk-used">{formatSize(diskInfo.used_bytes)}</span>
            </div>
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Scanned</span>
              <span className="disk-overview-value disk-scanned">{formatSize(rootNode.size)}</span>
            </div>
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Scanned %</span>
              <span className="disk-overview-value">{((rootNode.size / diskInfo.used_bytes) * 100).toFixed(1)}%</span>
            </div>
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Available</span>
              <span className="disk-overview-value disk-available">{formatSize(diskInfo.available_bytes)}</span>
            </div>
          </div>
        </div>
      )}

      {/* File Type Distribution Chart */}
      {rootNode && !isScanning && (
        <FileTypeChart node={currentNode || rootNode} />
      )}

      {/* Main Content */}
      <div className="main-content">
        {!rootNode && !isScanning && (
          <div className="welcome">
            <div className="welcome-icon">&#128193;</div>
            <h1>SpaceView</h1>
            <p>Visualize your disk space usage</p>
            <button className="welcome-btn" onClick={handleOpenFolder}>
              Open Folder
            </button>
            <div className="welcome-hint">Or press Cmd+O</div>

            {scanHistory.length > 0 && (
              <div className="scan-history">
                <h3>Recent Scans</h3>
                <div className="history-list">
                  {scanHistory.slice(0, 5).map((entry, index) => (
                    <button
                      key={index}
                      className="history-item"
                      onClick={() => scanPath(entry.scan_path, false)}
                    >
                      <div className="history-path">
                        <span className="history-icon">&#128193;</span>
                        {entry.scan_path.split("/").pop() || entry.scan_path}
                      </div>
                      <div className="history-meta">
                        <span className="history-size">{formatSize(entry.total_size)}</span>
                        <span className="history-time">{formatDate(entry.scanned_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isScanning && (
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

            {progress?.current_path && (
              <div className="scanning-path">
                <span className="scanning-path-label">Current:</span>
                <span className="scanning-path-value">{progress.current_path}</span>
              </div>
            )}

            <button
              className="scanning-cancel-btn"
              onClick={handleCancelScan}
              aria-label="Cancel scanning"
            >
              Cancel Scan
            </button>
          </div>
        )}

        {rootNode && !isScanning && (
          <div
            className={`treemap-container${isPanning ? " panning" : ""}`}
            ref={containerRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <div
              className="treemap-transform"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
            >
              {filteredRects.map((rect, index) => (
                rect.isContainer ? (
                  <TreemapContainerCell
                    key={rect.id + "-container"}
                    rect={rect}
                    isSelected={index === selectedIndex}
                    onHover={handleCellHover}
                    onLeave={handleCellLeave}
                    onNavigate={navigateTo}
                    onContextMenu={handleContextMenu}
                    onSelect={() => setSelectedIndex(index)}
                  />
                ) : (
                  <TreemapLeafCell
                    key={rect.id}
                    rect={rect}
                    isSelected={index === selectedIndex}
                    onHover={handleCellHover}
                    onLeave={handleCellLeave}
                    onNavigate={navigateTo}
                    onContextMenu={handleContextMenu}
                    onSelect={() => setSelectedIndex(index)}
                  />
                )
              ))}
            </div>
            {zoom !== 1 && (
              <button className="zoom-reset-btn" onClick={resetZoomPan} title="Reset zoom (double-click)">
                {Math.round(zoom * 100)}%
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status Bar */}
      {(hoveredNode || currentNode) && (
        <div className="status-bar">
          <span className="status-bar-path">
            {hoveredNode?.path || currentNode?.path}
          </span>
          <span className="status-bar-size">
            {formatSize(hoveredNode?.size || currentNode?.size || 0)}
          </span>
          {(hoveredNode || currentNode)?.is_dir && (
            <span>
              {(hoveredNode || currentNode)?.file_count.toLocaleString()} files,{" "}
              {(hoveredNode || currentNode)?.dir_count.toLocaleString()} folders
            </span>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => handleShowInFinder(contextMenu.node.path)}
          >
            <span>&#128193;</span> Show in Finder
          </div>
          <div
            className="context-menu-item"
            onClick={() => handleOpenFile(contextMenu.node.path)}
          >
            <span>&#128194;</span> Open
          </div>
          <div className="context-menu-divider" />
          <div
            className="context-menu-item danger"
            onClick={() => handleMoveToTrash(contextMenu.node.path)}
          >
            <span>&#128465;</span> Move to Trash
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hoveredNode && !contextMenu && (
        <div
          className="tooltip"
          style={{
            left: Math.min(tooltipPos.x, window.innerWidth - 340),
            top: Math.min(tooltipPos.y, window.innerHeight - 150),
          }}
        >
          <div className="tooltip-name">
            {getFileIcon(hoveredNode)} {hoveredNode.name}
          </div>
          <div className="tooltip-row">
            <span>Size</span>
            <span>{formatSize(hoveredNode.size)}</span>
          </div>
          {hoveredNode.modified_at && (
            <div className="tooltip-row">
              <span>Modified</span>
              <span>{formatDate(hoveredNode.modified_at)}</span>
            </div>
          )}
          {hoveredNode.is_dir && (
            <>
              <div className="tooltip-row">
                <span>Files</span>
                <span>{hoveredNode.file_count.toLocaleString()}</span>
              </div>
              <div className="tooltip-row">
                <span>Folders</span>
                <span>{hoveredNode.dir_count.toLocaleString()}</span>
              </div>
            </>
          )}
          <div
            className="tooltip-type"
            style={{ background: FILE_TYPE_COLORS[getFileType(hoveredNode)] + '30' }}
          >
            <span
              className="filter-dot"
              style={{ background: FILE_TYPE_COLORS[getFileType(hoveredNode)] }}
            />
            {FILE_TYPE_NAMES[getFileType(hoveredNode)]}
          </div>
        </div>
      )}

      {/* Error Notifications */}
      {errors.length > 0 && (
        <div className="error-notifications" role="alert" aria-live="assertive">
          {errors.map((error) => (
            <div
              key={error.id}
              className={`error-notification ${error.type}`}
            >
              <span className="error-icon">
                {error.type === 'error' ? '⚠️' : '⚡'}
              </span>
              <span className="error-message">{error.message}</span>
              <button
                className="error-dismiss"
                onClick={() => dismissError(error.id)}
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default App;
