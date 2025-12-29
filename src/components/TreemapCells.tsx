import React from "react";
import { FileNode, TreemapRect, formatSize, getFileGradient, getFileIcon } from "../types";

// Helper function to highlight matching text in search results
export function highlightText(text: string, searchText: string): React.ReactNode {
  if (!searchText) return text;
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

interface TreemapContainerCellProps {
  rect: TreemapRect;
  isSelected: boolean;
  animateEnter?: boolean;
  enterDelay?: number;
  onHover: (node: FileNode, e: React.MouseEvent) => void;
  onLeave: () => void;
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onSelect: () => void;
}

// Memoized container cell component to prevent re-renders
export const TreemapContainerCell = React.memo(function TreemapContainerCell({
  rect,
  isSelected,
  animateEnter,
  enterDelay,
  onHover,
  onLeave,
  onNavigate,
  onContextMenu,
  onSelect,
}: TreemapContainerCellProps) {
  const classNames = [
    "treemap-container-cell",
    `depth-${rect.depth}`,
    isSelected ? "selected" : "",
    animateEnter ? "cell-enter" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classNames}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        "--cell-delay": animateEnter ? `${enterDelay || 0}ms` : undefined,
      } as React.CSSProperties}
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

interface TreemapLeafCellProps {
  rect: TreemapRect;
  isSelected: boolean;
  isSearchMatch: boolean;
  isCurrentSearchMatch: boolean;
  searchText: string;
  animateEnter?: boolean;
  enterDelay?: number;
  onHover: (node: FileNode, e: React.MouseEvent) => void;
  onLeave: () => void;
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onSelect: () => void;
  onShowAggregated?: (rect: TreemapRect) => void;
}

// Memoized leaf cell component to prevent re-renders
export const TreemapLeafCell = React.memo(function TreemapLeafCell({
  rect,
  isSelected,
  isSearchMatch,
  isCurrentSearchMatch,
  searchText,
  animateEnter,
  enterDelay,
  onHover,
  onLeave,
  onNavigate,
  onContextMenu,
  onSelect,
  onShowAggregated,
}: TreemapLeafCellProps) {
  const isAggregated = rect.isAggregated === true;

  const classNames = [
    "treemap-cell",
    `depth-${rect.depth}`,
    isAggregated ? "aggregated-cell" : "",
    isSelected ? "selected" : "",
    isSearchMatch ? "search-match" : "",
    isCurrentSearchMatch ? "current-search-match" : "",
    animateEnter ? "cell-enter" : "",
  ].filter(Boolean).join(" ");

  const handleClick = () => {
    if (isAggregated && onShowAggregated) {
      onShowAggregated(rect);
    } else {
      onSelect();
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
        background: isAggregated
          ? "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)"
          : getFileGradient(rect.node),
        "--cell-delay": animateEnter ? `${enterDelay || 0}ms` : undefined,
      } as React.CSSProperties}
      onMouseEnter={(e) => !isAggregated && onHover(rect.node, e)}
      onMouseMove={(e) => !isAggregated && onHover(rect.node, e)}
      onMouseLeave={onLeave}
      onClick={handleClick}
      onDoubleClick={isAggregated ? undefined : () => onNavigate(rect.node)}
      onContextMenu={(e) => !isAggregated && onContextMenu(e, rect.node)}
      title={isAggregated ? `${rect.aggregatedCount} small files (${formatSize(rect.aggregatedSize || 0)})` : undefined}
    >
      {rect.width > 40 && rect.height > 30 && (
        <>
          {rect.height > 50 && (
            <div className="treemap-cell-icon">
              {isAggregated ? "📦" : getFileIcon(rect.node)}
            </div>
          )}
          <div className="treemap-cell-name">
            {isAggregated ? `+${rect.aggregatedCount}` : highlightText(rect.node.name, searchText)}
          </div>
          <div className="treemap-cell-size">
            {formatSize(isAggregated ? (rect.aggregatedSize || 0) : rect.node.size)}
          </div>
        </>
      )}
      {isAggregated && rect.width <= 40 && rect.height > 20 && (
        <div className="treemap-cell-name" style={{ fontSize: '10px' }}>
          +{rect.aggregatedCount}
        </div>
      )}
    </div>
  );
});
