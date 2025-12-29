import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  CleanableResult,
  CleanableProgress,
  CleanableItem,
  CleanableCategory,
  CLEANABLE_CATEGORY_NAMES,
  CLEANABLE_CATEGORY_ICONS,
  CLEANABLE_CATEGORY_COLORS,
  formatSize,
} from "./types";
import { useErrorNotification, useSettings } from "./contexts";

interface CleanableFilesPanelProps {
  scanPath: string;
  onClose: () => void;
  onShowInFinder: (path: string) => void;
  onMoveToTrash: (path: string) => Promise<void>;
}

export function CleanableFilesPanel({
  scanPath,
  onClose,
  onShowInFinder,
  onMoveToTrash,
}: CleanableFilesPanelProps) {
  const { showError, showInfo } = useErrorNotification();
  const { settings } = useSettings();

  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<CleanableProgress | null>(null);
  const [result, setResult] = useState<CleanableResult | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // Create size formatter with current settings
  const formatSizeWithUnit = useCallback((bytes: number) => {
    return formatSize(bytes, settings.size_unit);
  }, [settings.size_unit]);

  useEffect(() => {
    let unlistenProgress: UnlistenFn | undefined;

    const setup = async () => {
      unlistenProgress = await listen<CleanableProgress>(
        "cleanable-progress",
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
    setExpandedCategories(new Set());
    setSelectedItems(new Set());

    try {
      const cleanable = await invoke<CleanableResult | null>("find_cleanable", {
        path: scanPath,
      });
      if (cleanable) {
        setResult(cleanable);
        // Auto-expand categories with items
        const categories = new Set(cleanable.items.map(i => i.category));
        setExpandedCategories(categories);
      }
    } catch (err) {
      showError(`Cleanable scan failed: ${err}`);
    } finally {
      setIsScanning(false);
    }
  };

  const cancelScan = async () => {
    await invoke("cancel_cleanable_scan");
    setIsScanning(false);
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const toggleItemSelection = (path: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectAllInCategory = (category: CleanableCategory) => {
    if (!result) return;
    const categoryItems = result.items.filter(i => i.category === category);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      categoryItems.forEach(item => next.add(item.path));
      return next;
    });
  };

  const deselectAllInCategory = (category: CleanableCategory) => {
    if (!result) return;
    const categoryItems = result.items.filter(i => i.category === category);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      categoryItems.forEach(item => next.delete(item.path));
      return next;
    });
  };

  const deleteSelectedItems = async () => {
    if (selectedItems.size === 0) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete ${selectedItems.size} item(s)? This cannot be undone.`
    );

    if (!confirmDelete) return;

    setIsDeleting(true);
    let deletedCount = 0;
    let failedCount = 0;

    for (const path of selectedItems) {
      try {
        await onMoveToTrash(path);
        deletedCount++;
      } catch {
        failedCount++;
      }
    }

    setIsDeleting(false);
    setSelectedItems(new Set());

    if (deletedCount > 0) {
      showInfo(`Deleted ${deletedCount} item(s)${failedCount > 0 ? `, ${failedCount} failed` : ''}`);
      // Re-scan to update results
      startScan();
    } else if (failedCount > 0) {
      showError(`Failed to delete ${failedCount} item(s)`);
    }
  };

  // Group items by category
  const itemsByCategory: Record<CleanableCategory, CleanableItem[]> = result?.items.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<CleanableCategory, CleanableItem[]>) || ({} as Record<CleanableCategory, CleanableItem[]>);

  // Sort categories by size (largest first)
  const sortedCategories = Object.keys(itemsByCategory).sort((a, b) => {
    const sizeA = result?.size_by_category[a] || 0;
    const sizeB = result?.size_by_category[b] || 0;
    return sizeB - sizeA;
  }) as CleanableCategory[];

  // Calculate selected size
  const selectedSize = result?.items
    .filter(i => selectedItems.has(i.path))
    .reduce((sum, i) => sum + i.size, 0) || 0;

  const getRiskBadgeClass = (risk: string) => {
    switch (risk) {
      case "low": return "risk-low";
      case "medium": return "risk-medium";
      case "high": return "risk-high";
      default: return "risk-low";
    }
  };

  return (
    <div className="cleanable-panel">
      <div className="cleanable-header">
        <h3>Cleanable Files</h3>
        <button className="close-btn" onClick={onClose} title="Close">
          x
        </button>
      </div>

      <div className="cleanable-controls">
        {!isScanning ? (
          <button className="scan-btn" onClick={startScan}>
            Find Cleanable Files
          </button>
        ) : (
          <button className="cancel-btn" onClick={cancelScan}>
            Cancel
          </button>
        )}
        {selectedItems.size > 0 && !isDeleting && (
          <button
            className="delete-selected-btn"
            onClick={deleteSelectedItems}
            disabled={isDeleting}
          >
            Delete Selected ({selectedItems.size}) - {formatSizeWithUnit(selectedSize)}
          </button>
        )}
        {isDeleting && (
          <span className="deleting-indicator">Deleting...</span>
        )}
      </div>

      {progress && isScanning && (
        <div className="cleanable-progress">
          <div className="progress-phase">
            {progress.phase === "scanning" ? "Scanning for cleanable files..." : "Complete"}
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar progress-bar-indeterminate" />
          </div>
          <div className="progress-stats">
            <span>Found: {progress.items_found} items</span>
            <span>Size: {formatSizeWithUnit(progress.total_size)}</span>
          </div>
          {progress.current_path && (
            <div className="progress-current" title={progress.current_path}>
              {progress.current_path.length > 50
                ? "..." + progress.current_path.slice(-47)
                : progress.current_path}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="cleanable-result">
          <div className="result-summary">
            <div className="summary-item">
              <span className="summary-label">Items:</span>
              <span className="summary-value">{result.items.length}</span>
            </div>
            <div className="summary-item potential-savings">
              <span className="summary-label">Potential Savings:</span>
              <span className="summary-value">
                {formatSizeWithUnit(result.total_size)}
              </span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Scanned:</span>
              <span className="summary-value">{result.files_scanned.toLocaleString()} files</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Time:</span>
              <span className="summary-value">{(result.duration_ms / 1000).toFixed(1)}s</span>
            </div>
          </div>

          {result.items.length === 0 ? (
            <div className="no-cleanable">No cleanable files found!</div>
          ) : (
            <div className="cleanable-list">
              {sortedCategories.map((category) => {
                const items = itemsByCategory[category] || [];
                const categorySize = result.size_by_category[category] || 0;
                const categorySelectedCount = items.filter((i: CleanableItem) => selectedItems.has(i.path)).length;
                const allSelected = categorySelectedCount === items.length;

                return (
                  <div key={category} className="cleanable-category">
                    <div
                      className="category-header"
                      onClick={() => toggleCategory(category)}
                    >
                      <span className="expand-icon">
                        {expandedCategories.has(category) ? "v" : ">"}
                      </span>
                      <span
                        className="category-icon"
                        style={{ color: CLEANABLE_CATEGORY_COLORS[category] }}
                      >
                        {CLEANABLE_CATEGORY_ICONS[category]}
                      </span>
                      <span className="category-name">
                        {CLEANABLE_CATEGORY_NAMES[category]}
                      </span>
                      <span className="category-count">{items.length}</span>
                      <span className="category-size">
                        {formatSizeWithUnit(categorySize)}
                      </span>
                      {categorySelectedCount > 0 && (
                        <span className="category-selected">
                          ({categorySelectedCount} selected)
                        </span>
                      )}
                    </div>
                    {expandedCategories.has(category) && (
                      <div className="category-items">
                        <div className="category-actions">
                          <button
                            className="select-all-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (allSelected) {
                                deselectAllInCategory(category);
                              } else {
                                selectAllInCategory(category);
                              }
                            }}
                          >
                            {allSelected ? "Deselect All" : "Select All"}
                          </button>
                        </div>
                        {items
                          .sort((a: CleanableItem, b: CleanableItem) => b.size - a.size)
                          .map((item: CleanableItem) => (
                          <div
                            key={item.path}
                            className={`cleanable-item ${selectedItems.has(item.path) ? 'selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedItems.has(item.path)}
                              onChange={() => toggleItemSelection(item.path)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="item-info">
                              <div className="item-header">
                                <span className="item-name" title={item.path}>
                                  {item.is_dir ? "📁" : "📄"} {item.name}
                                </span>
                                <span className="item-size">
                                  {formatSizeWithUnit(item.size)}
                                </span>
                                <span className={`risk-badge ${getRiskBadgeClass(item.risk_level)}`}>
                                  {item.risk_level}
                                </span>
                              </div>
                              <div className="item-details">
                                <span className="item-description">{item.description}</span>
                                {item.is_dir && item.file_count > 0 && (
                                  <span className="item-file-count">
                                    ({item.file_count.toLocaleString()} files)
                                  </span>
                                )}
                              </div>
                              <div className="item-path" title={item.path}>
                                {item.path}
                              </div>
                            </div>
                            <div className="item-actions">
                              <button
                                className="show-btn"
                                onClick={() => onShowInFinder(item.path)}
                                title="Show in Finder"
                              >
                                Show
                              </button>
                              <button
                                className="delete-btn"
                                onClick={async () => {
                                  if (window.confirm(`Delete "${item.name}"?`)) {
                                    try {
                                      await onMoveToTrash(item.path);
                                      showInfo(`Deleted: ${item.name}`);
                                      startScan();
                                    } catch (err) {
                                      showError(`Failed to delete: ${err}`);
                                    }
                                  }
                                }}
                                title="Move to Trash"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!isScanning && !result && (
        <div className="cleanable-intro">
          <p>Find files and directories that can be safely cleaned to reclaim disk space.</p>
          <div className="intro-categories">
            <h4>Detectable Categories:</h4>
            <ul>
              <li><span className="cat-icon">📦</span> <strong>Dependencies</strong> - node_modules, vendor, Pods</li>
              <li><span className="cat-icon">🏗️</span> <strong>Build Output</strong> - dist, build, .next, target</li>
              <li><span className="cat-icon">💾</span> <strong>Caches</strong> - .cache, __pycache__, .gradle</li>
              <li><span className="cat-icon">📝</span> <strong>Logs</strong> - *.log, npm-debug.log</li>
              <li><span className="cat-icon">⏳</span> <strong>Temporary</strong> - tmp, *.tmp, *.swp</li>
              <li><span className="cat-icon">🛠️</span> <strong>IDE Files</strong> - .idea, *.iml</li>
              <li><span className="cat-icon">⚙️</span> <strong>System Files</strong> - .DS_Store, Thumbs.db</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
