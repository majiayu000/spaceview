import React, { useCallback } from "react";
import { FileNode, FileType, FILE_TYPE_COLORS, FILE_TYPE_NAMES } from "../types";
import { ThemeSwitcher } from "../ThemeSwitcher";

interface ToolbarProps {
  rootNode: FileNode | null;
  isScanning: boolean;
  isFromCache: boolean;
  cacheTime: number | null;
  filterType: FileType | null;
  showFilterMenu: boolean;
  searchText: string;
  useRegex: boolean;
  regexError: string | null;
  minSizeFilter: number;
  searchMatchIndices: number[];
  currentSearchMatchIndex: number;
  showDuplicates: boolean;
  showBackground: boolean;
  backgrounds: string[];
  bgIndex: number;
  onOpenFolder: () => void;
  onCancelScan: () => void;
  onRefreshScan: () => void;
  onFilterTypeChange: (type: FileType | null) => void;
  onShowFilterMenuChange: (show: boolean) => void;
  onSearchTextChange: (text: string) => void;
  onUseRegexChange: (useRegex: boolean) => void;
  onMinSizeFilterChange: (size: number) => void;
  onGoToNextSearchMatch: () => void;
  onGoToPrevSearchMatch: () => void;
  onJumpToLargest: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onShowDuplicatesChange: (show: boolean) => void;
  onShowBackgroundChange: (show: boolean) => void;
  onBgIndexChange: (index: number) => void;
  onOpenSettings: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

// Format cache time as relative string
function formatCacheTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString();
}

export const Toolbar = React.memo(function Toolbar({
  rootNode,
  isScanning,
  isFromCache,
  cacheTime,
  filterType,
  showFilterMenu,
  searchText,
  useRegex,
  regexError,
  minSizeFilter,
  searchMatchIndices,
  currentSearchMatchIndex,
  showDuplicates,
  showBackground,
  backgrounds,
  bgIndex,
  onOpenFolder,
  onCancelScan,
  onRefreshScan,
  onFilterTypeChange,
  onShowFilterMenuChange,
  onSearchTextChange,
  onUseRegexChange,
  onMinSizeFilterChange,
  onGoToNextSearchMatch,
  onGoToPrevSearchMatch,
  onJumpToLargest,
  onExportJSON,
  onExportCSV,
  onShowDuplicatesChange,
  onShowBackgroundChange,
  onBgIndexChange,
  onOpenSettings,
  searchInputRef,
}: ToolbarProps) {
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchMatchIndices.length > 0) {
      e.preventDefault();
      if (e.shiftKey) {
        onGoToPrevSearchMatch();
      } else {
        onGoToNextSearchMatch();
      }
    }
  }, [searchMatchIndices, onGoToPrevSearchMatch, onGoToNextSearchMatch]);

  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      <button
        className="toolbar-btn"
        onClick={onOpenFolder}
        disabled={isScanning}
        aria-label="Open folder to analyze"
      >
        <span aria-hidden="true">&#128193;</span> Open Folder
      </button>

      {isScanning && (
        <button
          className="toolbar-btn"
          onClick={onCancelScan}
          aria-label="Cancel current scan"
        >
          <span aria-hidden="true">&#10005;</span> Cancel
        </button>
      )}

      {rootNode && !isScanning && (
        <button
          className="toolbar-btn"
          onClick={onRefreshScan}
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
          onClick={() => onShowFilterMenuChange(!showFilterMenu)}
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
                onFilterTypeChange(null);
                onShowFilterMenuChange(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (onFilterTypeChange(null), onShowFilterMenuChange(false))}
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
                  onFilterTypeChange(type);
                  onShowFilterMenuChange(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (onFilterTypeChange(type), onShowFilterMenuChange(false))}
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
            onClick={() => onMinSizeFilterChange(0)}
          >
            All
          </button>
          <button
            className={`size-filter-btn${minSizeFilter === 100 * 1024 * 1024 ? " active" : ""}`}
            onClick={() => onMinSizeFilterChange(100 * 1024 * 1024)}
          >
            &gt;100MB
          </button>
          <button
            className={`size-filter-btn${minSizeFilter === 1024 * 1024 * 1024 ? " active" : ""}`}
            onClick={() => onMinSizeFilterChange(1024 * 1024 * 1024)}
          >
            &gt;1GB
          </button>
          <button
            className={`size-filter-btn${minSizeFilter === 10 * 1024 * 1024 * 1024 ? " active" : ""}`}
            onClick={() => onMinSizeFilterChange(10 * 1024 * 1024 * 1024)}
          >
            &gt;10GB
          </button>
        </div>
      )}

      {/* Jump to largest */}
      {rootNode && !isScanning && (
        <button
          className="toolbar-btn jump-largest-btn"
          onClick={onJumpToLargest}
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
            onClick={onExportJSON}
            title="Export scan results as JSON"
          >
            <span aria-hidden="true">📥</span> JSON
          </button>
          <button
            className="toolbar-btn export-btn"
            onClick={onExportCSV}
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
          onClick={() => onShowDuplicatesChange(!showDuplicates)}
          title="Find duplicate files"
        >
          <span aria-hidden="true">🔍</span> Duplicates
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
          onChange={(e) => onSearchTextChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          aria-label={useRegex ? "Search files with regex" : "Search files by name"}
          className={regexError ? "has-error" : ""}
        />
        {/* Regex toggle button */}
        <button
          className={`search-regex-btn${useRegex ? " active" : ""}${regexError ? " error" : ""}`}
          onClick={() => onUseRegexChange(!useRegex)}
          title={useRegex ? "Disable regex mode (.*)" : "Enable regex mode (.*)"}
          aria-label={useRegex ? "Disable regular expression mode" : "Enable regular expression mode"}
          aria-pressed={useRegex}
        >
          .*
        </button>
        {/* Regex error indicator */}
        {regexError && (
          <span className="search-regex-error" title={regexError}>
            ⚠
          </span>
        )}
        {searchText && searchMatchIndices.length > 0 && !regexError && (
          <div className="search-nav">
            <span className="search-count">
              {currentSearchMatchIndex + 1}/{searchMatchIndices.length}
            </span>
            <button
              className="search-nav-btn"
              onClick={onGoToPrevSearchMatch}
              title="Previous match (Shift+Enter)"
              aria-label="Previous search match"
            >
              ▲
            </button>
            <button
              className="search-nav-btn"
              onClick={onGoToNextSearchMatch}
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
            onClick={() => onSearchTextChange("")}
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
          onClick={() => onShowBackgroundChange(!showBackground)}
          title={showBackground ? "Hide background" : "Show background"}
        >
          <span aria-hidden="true">🎨</span>
        </button>
        {showBackground && (
          <button
            className="toolbar-btn bg-next-btn"
            onClick={() => onBgIndexChange((bgIndex + 1) % backgrounds.length)}
            title="Next background"
          >
            <span aria-hidden="true">→</span>
          </button>
        )}
      </div>

      <ThemeSwitcher />

      {/* Settings button */}
      <button
        className="toolbar-btn settings-btn"
        onClick={onOpenSettings}
        title="Settings (Cmd+,)"
        aria-label="Open settings"
      >
        <span aria-hidden="true">&#9881;</span>
      </button>
    </div>
  );
});
