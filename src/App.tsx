import { useEffect, useState, useCallback, useRef } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);

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
        console.error("Failed to get disk info:", e);
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
      console.error("Scan failed:", error);
      setIsScanning(false);
    }
  };

  const handleCancelScan = async () => {
    await invoke("cancel_scan");
    setIsScanning(false);
  };

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
    await invoke("show_in_finder", { path });
    setContextMenu(null);
  };

  const handleOpenFile = async (path: string) => {
    await invoke("open_file", { path });
    setContextMenu(null);
  };

  const handleMoveToTrash = async (path: string) => {
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
  };

  // Filter rects
  const filteredRects = treemapRects.filter((rect) => {
    if (filterType && getFileType(rect.node) !== filterType) return false;
    if (searchText && !rect.node.name.toLowerCase().includes(searchText.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <>
      {/* Toolbar */}
      <div className="toolbar">
        <button className="toolbar-btn" onClick={handleOpenFolder} disabled={isScanning}>
          <span>&#128193;</span> Open Folder
        </button>

        {isScanning && (
          <button className="toolbar-btn" onClick={handleCancelScan}>
            <span>&#10005;</span> Cancel
          </button>
        )}

        <div className="toolbar-divider" />

        <div className="filter-menu">
          <button
            className="filter-btn"
            onClick={() => setShowFilterMenu(!showFilterMenu)}
          >
            {filterType ? (
              <>
                <span
                  className="filter-dot"
                  style={{ background: FILE_TYPE_COLORS[filterType] }}
                />
                {FILE_TYPE_NAMES[filterType]}
              </>
            ) : (
              <>
                <span>&#9662;</span> Filter
              </>
            )}
          </button>

          {showFilterMenu && (
            <div className="filter-dropdown">
              <div
                className="filter-option"
                onClick={() => {
                  setFilterType(null);
                  setShowFilterMenu(false);
                }}
              >
                All Types
              </div>
              {(Object.keys(FILE_TYPE_COLORS) as FileType[]).map((type) => (
                <div
                  key={type}
                  className="filter-option"
                  onClick={() => {
                    setFilterType(type);
                    setShowFilterMenu(false);
                  }}
                >
                  <span
                    className="filter-dot"
                    style={{ background: FILE_TYPE_COLORS[type] }}
                  />
                  {FILE_TYPE_NAMES[type]}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="search-box">
          <span>&#128269;</span>
          <input
            type="text"
            placeholder="Search files..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {searchText && (
            <span
              style={{ cursor: "pointer" }}
              onClick={() => setSearchText("")}
            >
              &#10005;
            </span>
          )}
        </div>
      </div>

      {/* Breadcrumb */}
      {rootNode && (
        <div className="breadcrumb">
          <div
            className={`breadcrumb-item ${navigationPath.length === 0 ? "active" : ""}`}
            onClick={() => navigateToIndex(-1)}
          >
            <span>&#128193;</span> {rootNode.name}
          </div>
          {navigationPath.map((node, index) => (
            <span key={node.id}>
              <span className="breadcrumb-separator">&#8250;</span>
              <div
                className={`breadcrumb-item ${index === navigationPath.length - 1 ? "active" : ""}`}
                onClick={() => navigateToIndex(index)}
              >
                <span>&#128193;</span> {node.name}
              </div>
            </span>
          ))}
        </div>
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

        {isScanning && progress && (
          <div className="scanning">
            <h2>Scanning...</h2>
            <div className="scanning-progress">
              <div
                className="scanning-progress-bar"
                style={{ width: `${Math.min(99, (progress.scanned_files / 10000) * 100)}%` }}
              />
            </div>
            <div className="scanning-stats">
              <span>{progress.scanned_files.toLocaleString()} files</span>
              <span>{progress.scanned_dirs.toLocaleString()} folders</span>
              <span>{formatSize(progress.total_size)}</span>
            </div>
            <div className="scanning-path">{progress.current_path}</div>
          </div>
        )}

        {rootNode && !isScanning && (
          <div className="treemap-container" ref={containerRef}>
            {filteredRects.map((rect) => (
              rect.isContainer ? (
                // Container folder - shows border and header only
                <div
                  key={rect.id + "-container"}
                  className={`treemap-container-cell depth-${rect.depth}`}
                  style={{
                    left: rect.x,
                    top: rect.y,
                    width: rect.width,
                    height: rect.height,
                  }}
                  onMouseEnter={() => setHoveredNode(rect.node)}
                  onMouseMove={(e) => setTooltipPos({ x: e.clientX + 16, y: e.clientY + 16 })}
                  onMouseLeave={() => setHoveredNode(null)}
                  onDoubleClick={() => navigateTo(rect.node)}
                  onContextMenu={(e) => handleContextMenu(e, rect.node)}
                >
                  {rect.height > 50 && (
                    <div className="treemap-container-header">
                      <span className="treemap-container-name">{rect.node.name}</span>
                      <span className="treemap-container-size">{formatSize(rect.node.size)}</span>
                    </div>
                  )}
                </div>
              ) : (
                // Leaf node - file or small folder
                <div
                  key={rect.id}
                  className={`treemap-cell depth-${rect.depth}`}
                  style={{
                    left: rect.x,
                    top: rect.y,
                    width: rect.width,
                    height: rect.height,
                    background: getFileGradient(rect.node),
                  }}
                  onMouseEnter={() => setHoveredNode(rect.node)}
                  onMouseMove={(e) => setTooltipPos({ x: e.clientX + 16, y: e.clientY + 16 })}
                  onMouseLeave={() => setHoveredNode(null)}
                  onDoubleClick={() => navigateTo(rect.node)}
                  onContextMenu={(e) => handleContextMenu(e, rect.node)}
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
    </>
  );
}

export default App;
