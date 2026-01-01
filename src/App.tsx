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
  DeletedItem,
  DeleteLogEntry,
  WatcherStatus,
  IncrementalStatus,
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
import { applyTheme } from "./themes";
import { FileTypeChart } from "./FileTypeChart";
import { LargeFilesPanel } from "./LargeFilesPanel";
import { DuplicatesPanel } from "./DuplicatesPanel";
import { CleanableFilesPanel } from "./CleanableFilesPanel";
import ScanComparePanel from "./ScanComparePanel";
import { useVirtualizedRects } from "./hooks";
import { useSettings } from "./contexts";
import { SettingsPanel } from "./SettingsPanel";
import { OnboardingGuide } from "./OnboardingGuide";
import { KeyboardShortcutsPanel } from "./components/KeyboardShortcutsPanel";
import { ScanPerformanceStats } from "./components/ScanPerformanceStats";
import { themeList } from "./themes";

// Memoized container cell component to prevent re-renders
const TreemapContainerCell = React.memo(function TreemapContainerCell({
  rect,
  isSelected,
  onHover,
  onLeave,
  onNavigate,
  onContextMenu,
  onSelect,
  sizeUnit,
}: {
  rect: TreemapRect;
  isSelected: boolean;
  onHover: (node: FileNode, e: React.MouseEvent) => void;
  onLeave: () => void;
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onSelect: () => void;
  sizeUnit: "si" | "binary";
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
          <span className="treemap-container-size">{formatSize(rect.node.size, sizeUnit)}</span>
        </div>
      )}
    </div>
  );
});

// Helper function to highlight matching text (supports plain text and regex)
function highlightText(text: string, searchText: string, useRegex: boolean = false): React.ReactNode {
  if (!searchText) return text;

  if (useRegex) {
    try {
      const regex = new RegExp(`(${searchText})`, "gi");
      const parts = text.split(regex);
      if (parts.length === 1) return text; // No match
      return (
        <>
          {parts.map((part, i) =>
            regex.test(part) ? (
              <mark key={i} className="search-highlight">{part}</mark>
            ) : (
              part
            )
          )}
        </>
      );
    } catch {
      // Invalid regex, fall back to plain text search
      return text;
    }
  }

  // Plain text search
  const lowerText = text.toLowerCase();
  const lowerSearch = searchText.toLowerCase();
  const index = lowerText.indexOf(lowerSearch);
  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark className="search-highlight">{text.slice(index, index + searchText.length)}</mark>
      {text.slice(index + searchText.length)}
    </>
  );
}

// Memoized leaf cell component to prevent re-renders
const TreemapLeafCell = React.memo(function TreemapLeafCell({
  rect,
  isSelected,
  isSearchMatch,
  isCurrentSearchMatch,
  searchText,
  useRegex,
  onHover,
  onLeave,
  onNavigate,
  onNavigateToPath,
  onContextMenu,
  onSelect,
  sizeUnit,
}: {
  rect: TreemapRect;
  isSelected: boolean;
  isSearchMatch: boolean;
  isCurrentSearchMatch: boolean;
  searchText: string;
  useRegex: boolean;
  onHover: (node: FileNode, e: React.MouseEvent) => void;
  onLeave: () => void;
  onNavigate: (node: FileNode) => void;
  onNavigateToPath: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onSelect: () => void;
  sizeUnit: "si" | "binary";
}) {
  const isMoreItems = rect.node.name.startsWith("<") && rect.node.name.includes("more items");

  // Extract count from "<N more items>"
  const moreItemsCount = isMoreItems
    ? parseInt(rect.node.name.match(/\d+/)?.[0] || "0")
    : 0;

  const classNames = [
    "treemap-cell",
    `depth-${rect.depth}`,
    isMoreItems ? "more-items-cell" : "",
    isSelected ? "selected" : "",
    isSearchMatch ? "search-match" : "",
    isCurrentSearchMatch ? "current-search-match" : "",
  ].filter(Boolean).join(" ");

  // Handle double click - for "more items" navigate to parent folder
  const handleDoubleClick = () => {
    if (isMoreItems) {
      // The path of "more items" node is the parent folder path
      onNavigateToPath(rect.node.path);
    } else {
      onNavigate(rect.node);
    }
  };

  return (
    <div
      className={classNames}
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
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => onContextMenu(e, rect.node)}
    >
      {rect.width > 50 && rect.height > 35 && (
        <>
          {rect.height > 60 && (
            <div className="treemap-cell-icon">
              {isMoreItems ? "📁" : getFileIcon(rect.node)}
            </div>
          )}
          <div className="treemap-cell-name">
            {isMoreItems ? `+${moreItemsCount} more` : highlightText(rect.node.name, searchText, useRegex)}
          </div>
          <div className="treemap-cell-size">
            {formatSize(rect.node.size, sizeUnit)}
          </div>
        </>
      )}
    </div>
  );
});

interface ErrorNotification {
  id: number;
  message: string;
  type: 'error' | 'warning' | 'info';
}

function App() {
  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  const [currentNode, setCurrentNode] = useState<FileNode | null>(null);
  const [navigationPath, setNavigationPath] = useState<FileNode[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [hoveredNode, setHoveredNode] = useState<FileNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [filterType, setFilterType] = useState<FileType | null>(null);
  const [searchText, setSearchText] = useState("");
  const [useRegex, setUseRegex] = useState(false); // Enable regex search mode
  const [regexError, setRegexError] = useState<string | null>(null); // Invalid regex feedback
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
  const [currentSearchMatchIndex, setCurrentSearchMatchIndex] = useState<number>(-1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showBackground, setShowBackground] = useState(true);
  const [bgIndex, setBgIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showCleanable, setShowCleanable] = useState(false);
  const [showScanCompare, setShowScanCompare] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [lastDeleted, setLastDeleted] = useState<DeletedItem | null>(null);
  const [showUndoNotification, setShowUndoNotification] = useState(false);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCounter = useRef(0);
  const [lastFullScanAt, setLastFullScanAt] = useState<number | null>(null);
  const [lastIncrementalAt, setLastIncrementalAt] = useState<number | null>(null);
  const [deleteLog, setDeleteLog] = useState<DeleteLogEntry[]>([]);
  const [watcherActive, setWatcherActive] = useState(false);
  const [watcherError, setWatcherError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncIsFullRescan, setSyncIsFullRescan] = useState(false);

  // Get settings from context
  const { settings: appSettings, updateSettings } = useSettings();

  // Create a size formatter that uses the current settings
  const formatSizeWithUnit = useCallback((bytes: number) => {
    return formatSize(bytes, appSettings.size_unit);
  }, [appSettings.size_unit]);

  // Apply default theme from settings on startup
  useEffect(() => {
    if (appSettings.default_theme) {
      const theme = themeList.find(t => t.id === appSettings.default_theme);
      if (theme) {
        applyTheme(theme);
      }
    }
  }, []); // Only run once on mount

  // Local, CSP-safe background gradients
  const backgrounds = [
    "linear-gradient(135deg, #0f172a 0%, #1f2937 50%, #0b132b 100%)",
    "radial-gradient(circle at 20% 20%, #fef3c7 0%, #fde68a 25%, #fef3c7 55%, #fcd34d 100%)",
    "linear-gradient(120deg, #0ea5e9 0%, #2563eb 50%, #7c3aed 100%)",
    "linear-gradient(145deg, #111827 0%, #1f2937 45%, #4b5563 100%)",
  ];
  const errorIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load scan history on mount
  useEffect(() => {
    invoke<ScanHistoryEntry[]>("get_scan_history").then(setScanHistory).catch(console.error);
  }, []);

  // Load delete log for the current scan path
  useEffect(() => {
    if (!currentScanPath) {
      setDeleteLog([]);
      return;
    }
    invoke<DeleteLogEntry[]>("get_delete_log", { scan_path: currentScanPath, limit: 8 })
      .then(setDeleteLog)
      .catch(console.error);
  }, [currentScanPath]);

  const addNotification = useCallback((message: string, type: 'error' | 'warning' | 'info') => {
    const id = ++errorIdRef.current;
    setErrors(prev => [...prev, { id, message, type }]);
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setErrors(prev => prev.filter(e => e.id !== id));
    }, 5000);
  }, []);

  const showError = useCallback((message: string) => addNotification(message, 'error'), [addNotification]);
  const showWarning = useCallback((message: string) => addNotification(message, 'warning'), [addNotification]);
  const showInfo = useCallback((message: string) => addNotification(message, 'info'), [addNotification]);

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
        const now = Math.floor(Date.now() / 1000);
        setLastFullScanAt(now);
        setLastIncrementalAt(now);
      }
    });

    // Listen for cache-loaded events
    const unlistenCache = listen<CachedScan>("scan-from-cache", (event) => {
      console.log("[Cache] Loaded from cache:", event.payload.scanned_at);
      setIsFromCache(true);
      setCacheTime(event.payload.scanned_at);
      setIsScanning(false);
      setLastFullScanAt(event.payload.scanned_at);
      setLastIncrementalAt(event.payload.last_incremental_at ?? event.payload.scanned_at);
    });

    const unlistenWatcher = listen<WatcherStatus>("watcher-status", (event) => {
      setWatcherActive(event.payload.active);
      setWatcherError(event.payload.error ?? null);
    });

    const unlistenIncrementalStatus = listen<IncrementalStatus>("incremental-status", (event) => {
      if (event.payload.phase === "start") {
        setIsSyncing(true);
        setSyncIsFullRescan(event.payload.full_rescan);
      } else {
        setIsSyncing(false);
        setSyncIsFullRescan(false);
        if (event.payload.updated) {
          setLastIncrementalAt(event.payload.at);
        }
      }
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenCache.then((fn) => fn());
      unlistenWatcher.then((fn) => fn());
      unlistenIncrementalStatus.then((fn) => fn());
    };
  }, []);

  // Listen for Tauri file drop events
  useEffect(() => {
    const unlistenDrop = listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      if (isScanning) return;
      const paths = event.payload.paths;
      if (paths && paths.length > 0) {
        setIsDragging(false);
        await scanPath(paths[0], false);
      }
    });

    const unlistenDragEnter = listen("tauri://drag-enter", () => {
      if (!isScanning) {
        setIsDragging(true);
      }
    });

    const unlistenDragLeave = listen("tauri://drag-leave", () => {
      setIsDragging(false);
    });

    return () => {
      unlistenDrop.then((fn) => fn());
      unlistenDragEnter.then((fn) => fn());
      unlistenDragLeave.then((fn) => fn());
    };
  }, [isScanning]);

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

    // Update container size for virtualization
    setContainerSize({ width: bounds.width, height: bounds.height });
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
      setContainerSize({ width: newBounds.width, height: newBounds.height });
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
        showWarning(`Failed to get disk info: ${e}`);
      }

      // Start scanning - use cache based on settings unless forced
      const useCache = !forceRescan && appSettings.enable_cache;
      setIsScanning(true);
      setProgress(null);
      setScanStartTime(Date.now());
      const result = await invoke<FileNode | null>("scan_directory", {
        path,
        use_cache: useCache,
      });
      if (result) {
        setRootNode(result);
        setCurrentNode(result);
        setNavigationPath([]);
      }
      setScanStartTime(null);
      setIsScanning(false);
    } catch (error) {
      showError(`Scan failed: ${error}`);
      setScanStartTime(null);
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
    setScanStartTime(null);
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

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    if (isScanning) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Get the first dropped item's path
      const item = files[0];
      // In Tauri, we need to get the path from the file
      // The webkitRelativePath or path might not be available directly
      // We'll use the Tauri file drop event instead
      const path = (item as File & { path?: string }).path;
      if (path) {
        await scanPath(path, false);
      } else {
        showWarning("Unable to get folder path. Please use the Open Folder button instead.");
      }
    }
  }, [isScanning, showWarning]);

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

  // Build navigation path from root to target
  const buildNavigationPath = useCallback((root: FileNode | null, targetPath: string): FileNode[] => {
    if (!root) return [];
    if (root.path === targetPath) return [];
    for (const child of root.children) {
      if (targetPath === child.path || targetPath.startsWith(child.path + "/")) {
        if (child.path === targetPath) {
          return [child];
        }
        return [child, ...buildNavigationPath(child, targetPath)];
      }
    }
    return [];
  }, []);

  // Remove a node from the tree and recompute aggregates without a rescan
  const removeNodeFromTree = useCallback(
    (node: FileNode, targetPath: string): { updated: FileNode; removed: boolean } => {
      if (!node.is_dir) {
        return { updated: node, removed: false };
      }

      let removed = false;
      const newChildren: FileNode[] = [];

      for (const child of node.children) {
        if (child.path === targetPath) {
          removed = true;
          continue;
        }
        const { updated: updatedChild, removed: childRemoved } = removeNodeFromTree(child, targetPath);
        if (childRemoved) {
          removed = true;
        }
        newChildren.push(updatedChild);
      }

      if (!removed) {
        return { updated: node, removed: false };
      }

      const size = newChildren.reduce((sum, c) => sum + c.size, 0);
      const fileCount = newChildren.reduce(
        (sum, c) => sum + (c.is_dir ? c.file_count : 1),
        0
      );
      const dirCount = newChildren.reduce(
        (sum, c) => sum + (c.is_dir ? 1 + c.dir_count : 0),
        0
      );

      return {
        updated: { ...node, children: newChildren, size, file_count: fileCount, dir_count: dirCount },
        removed: true,
      };
    },
    []
  );

  const navigateTo = useCallback(
    (node: FileNode) => {
      // Only navigate into directories that have children
      if (node.is_dir && node.children.length > 0) {
        setNavigationPath((prev) => [...prev, node]);
        setCurrentNode(node);
      }
    },
    []
  );

  // Navigate to a path (used for "more items" to navigate to parent folder)
  const navigateToPath = useCallback(
    (path: string) => {
      const node = findNodeByPath(rootNode, path);
      if (node && node.is_dir && node.children.length > 0) {
        const newPath = buildNavigationPath(rootNode, path);
        setNavigationPath(newPath);
        setCurrentNode(node);
      }
    },
    [rootNode, findNodeByPath, buildNavigationPath]
  );

  const handleIncrementalUpdate = useCallback(
    (nextRoot: FileNode) => {
      setRootNode(nextRoot);
      const desiredPath = currentNode?.path || nextRoot.path;
      const nextCurrent = findNodeByPath(nextRoot, desiredPath) || nextRoot;
      setCurrentNode(nextCurrent);
      setNavigationPath(buildNavigationPath(nextRoot, nextCurrent.path));
      setIsFromCache(false);
      setIsScanning(false);
    },
    [currentNode, findNodeByPath, buildNavigationPath]
  );

  useEffect(() => {
    const unlistenIncremental = listen<FileNode>("scan-incremental", (event) => {
      handleIncrementalUpdate(event.payload);
    });

    return () => {
      unlistenIncremental.then((fn) => fn());
    };
  }, [handleIncrementalUpdate]);

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

  const handleCopyPath = async (path: string) => {
    try {
      await invoke("copy_to_clipboard", { text: path });
    } catch (e) {
      showError(`Failed to copy path: ${e}`);
    }
    setContextMenu(null);
  };

  const handleOpenInTerminal = async (path: string) => {
    try {
      await invoke("open_in_terminal", { path });
    } catch (e) {
      showError(`Failed to open in Terminal: ${e}`);
    }
    setContextMenu(null);
  };

  // Preview file using Quick Look (for future keyboard shortcut integration)
  const _handlePreviewFile = async (path: string) => {
    try {
      await invoke("preview_file", { path });
    } catch (e) {
      showError(`Failed to preview file: ${e}`);
    }
  };
  void _handlePreviewFile; // Suppress unused warning

  const handleIncrementalRefresh = async () => {
    try {
      setIsSyncing(true);
      await invoke("refresh_incremental");
    } catch (e) {
      showError(`Incremental refresh failed: ${e}`);
      setIsSyncing(false);
    }
  };

  const handleMoveToTrash = async (path: string) => {
    try {
      // Use move_to_trash_logged for logging
      await invoke("move_to_trash_logged", {
        path,
        scan_path: rootNode?.path || undefined,
        size_bytes: contextMenu?.node.size || undefined,
      });
      setContextMenu(null);

      if (rootNode) {
        // Trigger incremental refresh
        invoke("refresh_incremental").catch((e) =>
          showError(`Failed to sync changes: ${e}`)
        );

        const { updated, removed } = removeNodeFromTree(rootNode, path);
        if (removed) {
          setRootNode(updated);
          // Keep the user where they are if possible; otherwise fall back to root
          const desiredPath = currentNode?.path || updated.path;
          const nextCurrent = findNodeByPath(updated, desiredPath) || updated;
          setCurrentNode(nextCurrent);
          setNavigationPath(buildNavigationPath(updated, nextCurrent.path));
          setLastIncrementalAt(Math.floor(Date.now() / 1000));
        }

        // Clear selection if deleted item was selected
        if (selectedIndex >= 0) {
          setSelectedIndex(-1);
        }

        // Refresh delete log
        invoke<DeleteLogEntry[]>("get_delete_log", {
          scan_path: rootNode.path,
          limit: 8,
        })
          .then(setDeleteLog)
          .catch(console.error);
      }
    } catch (e) {
      showError(`Failed to move to trash: ${e}`);
      setContextMenu(null);
    }
  };

  // Undo deletion handler
  const handleUndo = async () => {
    if (!lastDeleted) return;

    try {
      await invoke<DeletedItem>("undo_delete");
      setShowUndoNotification(false);
      setLastDeleted(null);

      // Clear timeout
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = null;
      }

      // Rescan to update
      if (rootNode) {
        setIsScanning(true);
        const result = await invoke<FileNode | null>("scan_directory", {
          path: rootNode.path,
          useCache: false,
        });
        if (result) {
          setRootNode(result);
          setCurrentNode(result);
          setNavigationPath([]);
        }
        setIsScanning(false);
      }

      showInfo(`Restored "${lastDeleted.name}"`);
    } catch (e) {
      showError(`Failed to undo: ${e}`);
    }
  };

  // Create compiled regex for search (memoized to avoid recompilation)
  const searchRegex = useMemo(() => {
    if (!searchText || !useRegex) return null;
    try {
      setRegexError(null);
      return new RegExp(searchText, "i");
    } catch (e) {
      setRegexError(e instanceof Error ? e.message : "Invalid regex");
      return null;
    }
  }, [searchText, useRegex]);

  // Filter rects - memoized to avoid recalculation on every render
  const filteredRects = useMemo(() => {
    const lowerSearchText = searchText.toLowerCase();
    return treemapRects.filter((rect) => {
      if (filterType && getFileType(rect.node) !== filterType) return false;
      if (searchText) {
        if (useRegex) {
          // Regex search mode
          if (searchRegex && !searchRegex.test(rect.node.name)) {
            return false;
          }
          // If regex is invalid, don't filter (show all)
          if (!searchRegex && regexError) {
            return true;
          }
        } else {
          // Plain text search
          if (!rect.node.name.toLowerCase().includes(lowerSearchText)) {
            return false;
          }
        }
      }
      if (minSizeFilter > 0 && rect.node.size < minSizeFilter) return false;
      return true;
    });
  }, [treemapRects, filterType, searchText, useRegex, searchRegex, regexError, minSizeFilter]);

  // Compute search match indices (indices into filteredRects that match the search text)
  const searchMatchIndices = useMemo(() => {
    if (!searchText) return [];
    const lowerSearchText = searchText.toLowerCase();
    return filteredRects
      .map((rect, index) => ({ rect, index }))
      .filter(({ rect }) => {
        if (useRegex) {
          return searchRegex ? searchRegex.test(rect.node.name) : false;
        }
        return rect.node.name.toLowerCase().includes(lowerSearchText);
      })
      .map(({ index }) => index);
  }, [filteredRects, searchText, useRegex, searchRegex]);

  // Virtualize rects - only render cells visible in the viewport
  // This significantly improves performance with large treemaps
  const { visibleRects, visibleIndices } = useVirtualizedRects({
    rects: filteredRects,
    containerWidth: containerSize.width,
    containerHeight: containerSize.height,
    zoom,
    pan,
    overscan: 150, // Pre-render cells 150px outside viewport
    enabled: filteredRects.length > 100, // Only virtualize when there are many cells
  });

  // Reset search match index when search text changes or matches change
  useEffect(() => {
    if (searchMatchIndices.length > 0) {
      setCurrentSearchMatchIndex(0);
      // Auto-select first match
      setSelectedIndex(searchMatchIndices[0]);
    } else {
      setCurrentSearchMatchIndex(-1);
    }
  }, [searchMatchIndices]);

  // Navigate to next/previous search match
  const goToNextSearchMatch = useCallback(() => {
    if (searchMatchIndices.length === 0) return;
    const nextIndex = (currentSearchMatchIndex + 1) % searchMatchIndices.length;
    setCurrentSearchMatchIndex(nextIndex);
    setSelectedIndex(searchMatchIndices[nextIndex]);
  }, [searchMatchIndices, currentSearchMatchIndex]);

  const goToPrevSearchMatch = useCallback(() => {
    if (searchMatchIndices.length === 0) return;
    const prevIndex = currentSearchMatchIndex <= 0
      ? searchMatchIndices.length - 1
      : currentSearchMatchIndex - 1;
    setCurrentSearchMatchIndex(prevIndex);
    setSelectedIndex(searchMatchIndices[prevIndex]);
  }, [searchMatchIndices, currentSearchMatchIndex]);

  // Keep selection in range when filters/search change
  useEffect(() => {
    if (selectedIndex >= filteredRects.length) {
      setSelectedIndex(filteredRects.length > 0 ? filteredRects.length - 1 : -1);
    }
  }, [filteredRects, selectedIndex]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if typing in an input field
      const isTyping = document.activeElement?.tagName === 'INPUT' ||
                       document.activeElement?.tagName === 'TEXTAREA';

      // Cmd+O / Ctrl+O to open folder
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        if (!isScanning) {
          handleOpenFolder();
        }
        return;
      }

      // Cmd+F / Ctrl+F to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Cmd+, to open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
        return;
      }

      // Cmd+Z to undo last deletion
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (lastDeleted && showUndoNotification) {
          e.preventDefault();
          handleUndo();
          return;
        }
      }

      // ? or Cmd+/ to show keyboard shortcuts
      if (e.key === '?' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

      // F3 or Cmd+G / Ctrl+G - navigate search results
      if (e.key === 'F3' || ((e.metaKey || e.ctrlKey) && e.key === 'g')) {
        e.preventDefault();
        if (searchText && searchMatchIndices.length > 0) {
          if (e.shiftKey) {
            goToPrevSearchMatch();
          } else {
            goToNextSearchMatch();
          }
        }
        return;
      }

      // Escape - close menus, blur search, and deselect
      if (e.key === 'Escape') {
        if (isTyping) {
          (document.activeElement as HTMLElement)?.blur();
        }
        setContextMenu(null);
        setShowFilterMenu(false);
        setSelectedIndex(-1);
        return;
      }

      // Don't handle other navigation keys if typing or scanning
      if (isTyping || isScanning) return;

      // Don't handle navigation keys if no treemap
      if (filteredRects.length === 0) return;

      // Cmd+Delete or Cmd+Backspace - delete selected item
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selectedIndex >= 0 && selectedIndex < filteredRects.length) {
          e.preventDefault();
          const selectedNode = filteredRects[selectedIndex].node;
          handleMoveToTrash(selectedNode.path);
          setSelectedIndex(-1);
        }
        return;
      }

      // Backspace - go back in navigation (without Cmd)
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

        // If the filtered list shrank, clamp the selection before using it
        if (selectedIndex >= filteredRects.length) {
          setSelectedIndex(filteredRects.length > 0 ? filteredRects.length - 1 : -1);
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
    <div
      className="app-container"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Skip link for keyboard users */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Drag and Drop Overlay */}
      {isDragging && (
        <div className="drop-overlay" aria-live="polite">
          <div className="drop-overlay-content">
            <span className="drop-overlay-icon" aria-hidden="true">📁</span>
            <span className="drop-overlay-text">Drop folder to scan</span>
          </div>
        </div>
      )}

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

        {/* Find Duplicates button */}
        {rootNode && !isScanning && (
          <button
            className={`toolbar-btn duplicates-btn${showDuplicates ? " active" : ""}`}
            onClick={() => setShowDuplicates(!showDuplicates)}
            title="Find duplicate files"
          >
            <span aria-hidden="true">🔍</span> Duplicates
          </button>
        )}

        {/* Cleanable Files button */}
        {rootNode && !isScanning && (
          <button
            className={`toolbar-btn cleanable-btn${showCleanable ? " active" : ""}`}
            onClick={() => setShowCleanable(!showCleanable)}
            title="Find cleanable files (node_modules, caches, etc.)"
          >
            <span aria-hidden="true">🧹</span> Clean
          </button>
        )}

        {/* Scan Compare button */}
        {rootNode && !isScanning && (
          <button
            className={`toolbar-btn compare-btn${showScanCompare ? " active" : ""}`}
            onClick={() => setShowScanCompare(!showScanCompare)}
            title="Compare scan snapshots over time"
          >
            <span aria-hidden="true">📸</span> Snapshots
          </button>
        )}

        <div className="search-box">
          <span aria-hidden="true">&#128269;</span>
          <label htmlFor="file-search" className="visually-hidden">Search files</label>
          <input
            ref={searchInputRef}
            id="file-search"
            type="text"
            placeholder={useRegex ? "Regex pattern... (Cmd+F)" : "Search files... (Cmd+F)"}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchMatchIndices.length > 0) {
                e.preventDefault();
                if (e.shiftKey) {
                  goToPrevSearchMatch();
                } else {
                  goToNextSearchMatch();
                }
              }
            }}
            aria-label={useRegex ? "Search files with regex" : "Search files by name"}
            className={regexError ? "has-error" : ""}
          />
          {/* Regex toggle button */}
          <button
            className={`search-regex-btn${useRegex ? " active" : ""}${regexError ? " error" : ""}`}
            onClick={() => setUseRegex(!useRegex)}
            title={useRegex ? "Disable regex mode (.*)" : "Enable regex mode (.*)"}
            aria-label={useRegex ? "Disable regular expression mode" : "Enable regular expression mode"}
            aria-pressed={useRegex}
          >
            .*
          </button>
          {/* Regex error indicator */}
          {regexError && (
            <span className="search-regex-error" title={regexError}>
              ⚠️
            </span>
          )}
          {searchText && searchMatchIndices.length > 0 && !regexError && (
            <div className="search-nav">
              <span className="search-count">
                {currentSearchMatchIndex + 1}/{searchMatchIndices.length}
              </span>
              <button
                className="search-nav-btn"
                onClick={goToPrevSearchMatch}
                title="Previous match (Shift+Enter)"
                aria-label="Previous search match"
              >
                ▲
              </button>
              <button
                className="search-nav-btn"
                onClick={goToNextSearchMatch}
                title="Next match (Enter)"
                aria-label="Next search match"
              >
                ▼
              </button>
            </div>
          )}
          {searchText && searchMatchIndices.length === 0 && !regexError && (
            <span className="search-no-results">No results</span>
          )}
          {searchText && (
            <button
              className="search-clear"
              onClick={() => setSearchText("")}
              aria-label="Clear search"
            >
              &#10005;
            </button>
          )}
        </div>

        {/* Background toggle */}
        <div className="bg-controls">
          <button
            className={`toolbar-btn bg-toggle-btn${showBackground ? " active" : ""}`}
            onClick={() => setShowBackground(!showBackground)}
            title={showBackground ? "Hide background" : "Show background"}
          >
            <span aria-hidden="true">🎨</span>
          </button>
          {showBackground && (
            <button
              className="toolbar-btn bg-next-btn"
              onClick={() => setBgIndex((prev) => (prev + 1) % backgrounds.length)}
              title="Next background"
            >
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>

        {/* Settings button */}
        <button
          className="toolbar-btn settings-btn"
          onClick={() => setShowSettings(true)}
          title="Settings (Cmd+,)"
        >
          <span aria-hidden="true">⚙️</span>
        </button>

        {/* Help button */}
        <button
          className="toolbar-btn help-btn"
          onClick={() => setShowShortcuts(true)}
          title="Keyboard Shortcuts (?)"
        >
          <span aria-hidden="true">?</span>
        </button>

        <ThemeSwitcher />
      </div>

      {rootNode && (
        <div className="trust-bar" role="status" aria-live="polite">
          <div className="trust-item">
            <span className="trust-label">Full Scan</span>
            <span className="trust-value">
              {lastFullScanAt ? formatCacheTime(lastFullScanAt) : "—"}
            </span>
          </div>
          <div className="trust-item">
            <span className="trust-label">Incremental</span>
            <span className="trust-value">
              {lastIncrementalAt ? formatCacheTime(lastIncrementalAt) : "—"}
            </span>
          </div>
          <div className="trust-item">
            <span className="trust-label">Watcher</span>
            <span className={`trust-value${watcherActive ? " trust-live" : " trust-off"}`}>
              {watcherActive ? "Live" : "Off"}
            </span>
          </div>
          <button
            className="trust-refresh-btn"
            onClick={handleIncrementalRefresh}
            title="Refresh incremental changes"
            disabled={isSyncing}
          >
            {isSyncing ? "Syncing..." : "Sync"}
          </button>
          {syncIsFullRescan && (
            <div className="trust-item">
              <span className="trust-label">Mode</span>
              <span className="trust-value">Full Rescan</span>
            </div>
          )}
          {deleteLog.length > 0 && (
            <div className="trust-item">
              <span className="trust-label">Recent Deletes</span>
              <span className="trust-value">{deleteLog.length}</span>
            </div>
          )}
          {watcherError && (
            <div className="trust-item">
              <span className="trust-label">Watcher Error</span>
              <span className="trust-value">{watcherError}</span>
            </div>
          )}
        </div>
      )}

      {/* Anime Background */}
      {showBackground && (
        <div
          className="anime-background"
          style={{ backgroundImage: backgrounds[bgIndex] }}
        />
      )}

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
              <span className="disk-overview-value">{formatSizeWithUnit(diskInfo.total_bytes)}</span>
            </div>
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Disk Used</span>
              <span className="disk-overview-value disk-used">{formatSizeWithUnit(diskInfo.used_bytes)}</span>
            </div>
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Scanned</span>
              <span className="disk-overview-value disk-scanned">{formatSizeWithUnit(rootNode.size)}</span>
            </div>
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Scanned %</span>
              <span className="disk-overview-value">{((rootNode.size / diskInfo.used_bytes) * 100).toFixed(1)}%</span>
            </div>
            <div className="disk-overview-stat">
              <span className="disk-overview-label">Available</span>
              <span className="disk-overview-value disk-available">{formatSizeWithUnit(diskInfo.available_bytes)}</span>
            </div>
          </div>
        </div>
      )}

      {/* File Type Distribution Chart */}
      {rootNode && !isScanning && (
        <FileTypeChart node={currentNode || rootNode} />
      )}

      {/* Large Files Panel */}
      {rootNode && !isScanning && (
        <LargeFilesPanel
          rootNode={rootNode}
          onNavigateToFile={(filePath) => {
            // Find and navigate to the parent directory of the file
            const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
            const parentNode = findNodeByPath(rootNode, parentPath);
            if (parentNode && parentNode.is_dir) {
              setNavigationPath([]);
              setCurrentNode(parentNode);
              // Build navigation path from root to parent
              const buildPath = (target: string, node: FileNode, path: FileNode[]): FileNode[] | null => {
                if (node.path === target) return path;
                for (const child of node.children) {
                  if (target.startsWith(child.path)) {
                    const result = buildPath(target, child, [...path, child]);
                    if (result) return result;
                  }
                }
                return null;
              };
              const navPath = buildPath(parentPath, rootNode, []);
              if (navPath) {
                setNavigationPath(navPath);
                setCurrentNode(parentNode);
              }
            }
          }}
        />
      )}

      {/* Duplicates Panel */}
      {showDuplicates && rootNode && !isScanning && (
        <DuplicatesPanel
          scanPath={rootNode.path}
          onClose={() => setShowDuplicates(false)}
          onShowInFinder={handleShowInFinder}
        />
      )}

      {/* Cleanable Files Panel */}
      {showCleanable && rootNode && !isScanning && (
        <CleanableFilesPanel
          scanPath={rootNode.path}
          onClose={() => setShowCleanable(false)}
          onShowInFinder={handleShowInFinder}
          onMoveToTrash={handleMoveToTrash}
        />
      )}

      {/* Scan Compare Panel */}
      {showScanCompare && rootNode && !isScanning && (
        <ScanComparePanel
          scanPath={rootNode.path}
          onClose={() => setShowScanCompare(false)}
        />
      )}

      {/* Delete Log */}
      {rootNode && deleteLog.length > 0 && !isScanning && (
        <div className="delete-log">
          <div className="delete-log-header">Recent Deletes</div>
          <div className="delete-log-list">
            {deleteLog.slice(0, 6).map((entry) => (
              <div key={entry.id} className="delete-log-item">
                <span className="delete-log-path">
                  {entry.target_path.split("/").pop() || entry.target_path}
                </span>
                <span className="delete-log-size">{formatSize(entry.size_bytes)}</span>
                <span className="delete-log-time">{formatDate(entry.deleted_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main id="main-content" className="main-content" role="main" tabIndex={-1}>
        {!rootNode && !isScanning && (
          <div className="welcome">
            <div className="welcome-icon" aria-hidden="true">&#128193;</div>
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
                        <span className="history-size">{formatSizeWithUnit(entry.total_size)}</span>
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
                  {formatSizeWithUnit(progress?.total_size ?? 0)}
                </span>
                <span className="scanning-stat-label">Total Size</span>
              </div>
            </div>

            {/* Performance stats */}
            {scanStartTime && progress && (
              <ScanPerformanceStats startTime={scanStartTime} progress={progress} />
            )}

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
              {visibleRects.map((rect, visibleIdx) => {
                // Map visible index back to original filteredRects index
                const originalIndex = visibleIndices[visibleIdx];
                return (
                rect.isContainer ? (
                  <TreemapContainerCell
                    key={rect.id + "-container"}
                    rect={rect}
                    isSelected={originalIndex === selectedIndex}
                    onHover={handleCellHover}
                    onLeave={handleCellLeave}
                    onNavigate={navigateTo}
                    onContextMenu={handleContextMenu}
                    onSelect={() => setSelectedIndex(originalIndex)}
                    sizeUnit={appSettings.size_unit}
                  />
                ) : (
                  <TreemapLeafCell
                    key={rect.id}
                    rect={rect}
                    isSelected={originalIndex === selectedIndex}
                    isSearchMatch={searchMatchIndices.includes(originalIndex)}
                    isCurrentSearchMatch={searchMatchIndices[currentSearchMatchIndex] === originalIndex}
                    searchText={searchText}
                    useRegex={useRegex}
                    onHover={handleCellHover}
                    onLeave={handleCellLeave}
                    onNavigate={navigateTo}
                    onNavigateToPath={navigateToPath}
                    onContextMenu={handleContextMenu}
                    onSelect={() => setSelectedIndex(originalIndex)}
                    sizeUnit={appSettings.size_unit}
                  />
                )
                );
              })}
            </div>
            {zoom !== 1 && (
              <button className="zoom-reset-btn" onClick={resetZoomPan} title="Reset zoom (double-click)">
                {Math.round(zoom * 100)}%
              </button>
            )}
          </div>
        )}
      </main>

      {/* Status Bar */}
      {(hoveredNode || currentNode) && (
        <div className="status-bar">
          <span className="status-bar-path">
            {hoveredNode?.path || currentNode?.path}
          </span>
          <span className="status-bar-size">
            {formatSizeWithUnit(hoveredNode?.size || currentNode?.size || 0)}
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
          role="menu"
          aria-label={`Actions for ${contextMenu.node.name}`}
        >
          <div
            className="context-menu-item"
            onClick={() => handleShowInFinder(contextMenu.node.path)}
            role="menuitem"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleShowInFinder(contextMenu.node.path)}
          >
            <span aria-hidden="true">&#128193;</span> Show in Finder
          </div>
          <div
            className="context-menu-item"
            onClick={() => handleOpenFile(contextMenu.node.path)}
            role="menuitem"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleOpenFile(contextMenu.node.path)}
          >
            <span aria-hidden="true">&#128194;</span> Open
          </div>
          <div className="context-menu-divider" role="separator" />
          <div
            className="context-menu-item"
            onClick={() => handleCopyPath(contextMenu.node.path)}
            role="menuitem"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleCopyPath(contextMenu.node.path)}
          >
            <span aria-hidden="true">&#128203;</span> Copy Path
          </div>
          <div
            className="context-menu-item"
            onClick={() => handleOpenInTerminal(contextMenu.node.path)}
            role="menuitem"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleOpenInTerminal(contextMenu.node.path)}
          >
            <span aria-hidden="true">&#9002;</span> Open in Terminal
          </div>
          <div className="context-menu-divider" role="separator" />
          <div
            className="context-menu-item danger"
            onClick={() => handleMoveToTrash(contextMenu.node.path)}
            role="menuitem"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleMoveToTrash(contextMenu.node.path)}
          >
            <span aria-hidden="true">&#128465;</span> Move to Trash
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
            <span>{formatSizeWithUnit(hoveredNode.size)}</span>
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

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSettingsChange={updateSettings}
        onShowOnboarding={() => setShowOnboarding(true)}
      />

      {/* Keyboard Shortcuts Panel */}
      <KeyboardShortcutsPanel
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Onboarding Guide */}
      <OnboardingGuide
        onComplete={() => setShowOnboarding(false)}
        forceShow={showOnboarding}
      />
    </div>
  );
}

export default App;
