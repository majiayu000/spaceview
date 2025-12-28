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
  FILE_TYPE_COLORS,
  FILE_TYPE_NAMES,
  FILE_TYPE_ICONS,
  getFileGradient,
  getFileIcon,
  getFileType,
  formatSize,
} from "./types";
import { layoutTreemap } from "./treemap";

// Memoized container cell component to prevent re-renders
const TreemapContainerCell = React.memo(function TreemapContainerCell({
  rect,
  onHover,
  onLeave,
  onNavigate,
  onContextMenu,
}: {
  rect: TreemapRect;
  onHover: (node: FileNode, e: React.MouseEvent) => void;
  onLeave: () => void;
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
}) {
  return (
    <div
      className={`treemap-container-cell depth-${rect.depth}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
      onMouseEnter={(e) => onHover(rect.node, e)}
      onMouseMove={(e) => onHover(rect.node, e)}
      onMouseLeave={onLeave}
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
  onHover,
  onLeave,
  onNavigate,
  onContextMenu,
}: {
  rect: TreemapRect;
  onHover: (node: FileNode, e: React.MouseEvent) => void;
  onLeave: () => void;
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
}) {
  return (
    <div
      className={`treemap-cell depth-${rect.depth}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: getFileGradient(rect.node),
      }}
      onMouseEnter={(e) => onHover(rect.node, e)}
      onMouseMove={(e) => onHover(rect.node, e)}
      onMouseLeave={onLeave}
      onDoubleClick={() => onNavigate(rect.node)}
      onContextMenu={(e) => onContextMenu(e, rect.node)}
    >
      {rect.width > 50 && rect.height > 35 && (
        <>
          {rect.height > 60 && (
            <div className="treemap-cell-icon">
              {getFileIcon(rect.node)}
            </div>
          )}
          <div className="treemap-cell-name">{rect.node.name}</div>
          {rect.height > 55 && (
            <div className="treemap-cell-size">
              {formatSize(rect.node.size)}
            </div>
          )}
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
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode;
  } | null>(null);
  const [treemapRects, setTreemapRects] = useState<TreemapRect[]>([]);
  const [diskInfo, setDiskInfo] = useState<DiskSpaceInfo | null>(null);
  const [errors, setErrors] = useState<ErrorNotification[]>([]);
  const errorIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const unlisten = listen<ScanProgress>("scan-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.is_complete) {
        setIsScanning(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
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

      // Fetch disk info for the selected path
      try {
        const info = await invoke<DiskSpaceInfo>("get_disk_info", { path: selectedPath });
        setDiskInfo(info);
      } catch (e) {
        showError(`Failed to get disk info: ${e}`, 'warning');
      }

      // Then start scanning
      setIsScanning(true);
      setProgress(null);
      const result = await invoke<FileNode | null>("scan_directory", {
        path: selectedPath,
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

  const handleCancelScan = async () => {
    await invoke("cancel_scan");
    setIsScanning(false);
  };

  // Keyboard shortcuts: Cmd+O (macOS) or Ctrl+O (other) to open folder
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        if (!isScanning) {
          handleOpenFolder();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isScanning]);

  const navigateTo = useCallback(
    (node: FileNode) => {
      // Only navigate into directories that have children and are not placeholder nodes
      if (node.is_dir && node.children.length > 0 && !node.name.startsWith("<")) {
        setNavigationPath((prev) => [...prev, node]);
        setCurrentNode(node);
      }
    },
    []
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
      return true;
    });
  }, [treemapRects, filterType, searchText]);

  // Stable callbacks for memoized treemap cells
  const handleCellHover = useCallback((node: FileNode, e: React.MouseEvent) => {
    setHoveredNode(node);
    setTooltipPos({ x: e.clientX + 16, y: e.clientY + 16 });
  }, []);

  const handleCellLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

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
          <div className="treemap-container" ref={containerRef}>
            {filteredRects.map((rect) => (
              rect.isContainer ? (
                <TreemapContainerCell
                  key={rect.id + "-container"}
                  rect={rect}
                  onHover={handleCellHover}
                  onLeave={handleCellLeave}
                  onNavigate={navigateTo}
                  onContextMenu={handleContextMenu}
                />
              ) : (
                <TreemapLeafCell
                  key={rect.id}
                  rect={rect}
                  onHover={handleCellHover}
                  onLeave={handleCellLeave}
                  onNavigate={navigateTo}
                  onContextMenu={handleContextMenu}
                />
              )
            ))}
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
