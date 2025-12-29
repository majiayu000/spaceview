import React, { useState, useCallback, useMemo } from "react";
import {
  FileNode,
  FileType,
  getFileType,
  getFileIcon,
  formatSize,
  formatDate,
  FILE_TYPE_COLORS,
} from "../types";

interface ListViewProps {
  node: FileNode;
  filterType: FileType | null;
  searchText: string;
  minSizeFilter: number;
  sortField: "size" | "name" | "date";
  sortOrder: "asc" | "desc";
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onSelect: (node: FileNode) => void;
  selectedPath: string | null;
}

interface ListRowProps {
  node: FileNode;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (node: FileNode) => void;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onSelect: () => void;
  isSelected: boolean;
  searchText: string;
  maxSize: number;
}

// Highlight matching text in search results
function highlightText(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}

// Memoized list row component for performance
const ListRow = React.memo<ListRowProps>(({
  node,
  depth,
  expanded,
  onToggle,
  onNavigate,
  onContextMenu,
  onSelect,
  isSelected,
  searchText,
  maxSize,
}) => {
  const fileType = getFileType(node);
  const hasChildren = node.is_dir && node.children.length > 0;
  const sizePercent = maxSize > 0 ? (node.size / maxSize) * 100 : 0;

  const handleDoubleClick = useCallback(() => {
    if (node.is_dir && node.children.length > 0) {
      onNavigate(node);
    }
  }, [node, onNavigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (node.is_dir && node.children.length > 0) {
        onNavigate(node);
      }
    } else if (e.key === " ") {
      e.preventDefault();
      if (hasChildren) {
        onToggle();
      }
    }
  }, [node, hasChildren, onNavigate, onToggle]);

  return (
    <div
      className={`list-row${isSelected ? " selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => onContextMenu(e, node)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="row"
      aria-selected={isSelected}
      style={{ paddingLeft: depth * 20 + 8 }}
    >
      {/* Expand/Collapse Toggle */}
      <span
        className={`list-toggle${hasChildren ? "" : " invisible"}`}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle();
        }}
      >
        {hasChildren ? (expanded ? "▼" : "▶") : ""}
      </span>

      {/* File Icon */}
      <span className="list-icon">{getFileIcon(node)}</span>

      {/* File Name */}
      <span className="list-name" title={node.path}>
        {highlightText(node.name, searchText)}
      </span>

      {/* File Type Badge */}
      <span
        className="list-type"
        style={{ backgroundColor: FILE_TYPE_COLORS[fileType] + "30", color: FILE_TYPE_COLORS[fileType] }}
      >
        {fileType}
      </span>

      {/* Size Bar */}
      <span className="list-size-bar-container">
        <span
          className="list-size-bar"
          style={{
            width: `${sizePercent}%`,
            backgroundColor: FILE_TYPE_COLORS[fileType],
          }}
        />
      </span>

      {/* Size */}
      <span className="list-size">{formatSize(node.size)}</span>

      {/* Modified Date */}
      <span className="list-date">
        {node.modified_at ? formatDate(node.modified_at) : "—"}
      </span>

      {/* Item Count (for directories) */}
      <span className="list-count">
        {node.is_dir ? `${node.file_count} files` : ""}
      </span>
    </div>
  );
});

ListRow.displayName = "ListRow";

export const ListView = React.memo<ListViewProps>(({
  node,
  filterType,
  searchText,
  minSizeFilter,
  sortField,
  sortOrder,
  onNavigate,
  onContextMenu,
  onSelect,
  selectedPath,
}) => {
  // Track expanded folders
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([node.path]));

  // Toggle folder expansion
  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Expand all / collapse all
  const expandAll = useCallback(() => {
    const allPaths = new Set<string>();
    const collectPaths = (n: FileNode) => {
      if (n.is_dir) {
        allPaths.add(n.path);
        n.children.forEach(collectPaths);
      }
    };
    collectPaths(node);
    setExpandedPaths(allPaths);
  }, [node]);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set([node.path]));
  }, [node.path]);

  // Filter and sort nodes
  const matchesFilter = useCallback((n: FileNode): boolean => {
    if (filterType && getFileType(n) !== filterType) return false;
    if (searchText && !n.name.toLowerCase().includes(searchText.toLowerCase())) {
      // Check if any descendant matches
      if (n.is_dir) {
        return n.children.some(child => matchesFilter(child));
      }
      return false;
    }
    if (minSizeFilter > 0 && n.size < minSizeFilter) return false;
    return true;
  }, [filterType, searchText, minSizeFilter]);

  const sortNodes = useCallback((nodes: FileNode[]): FileNode[] => {
    return [...nodes].sort((a, b) => {
      // Directories first
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;

      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "size":
          cmp = a.size - b.size;
          break;
        case "date":
          cmp = (a.modified_at || 0) - (b.modified_at || 0);
          break;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [sortField, sortOrder]);

  // Build flattened list of visible rows
  const visibleRows = useMemo(() => {
    const rows: { node: FileNode; depth: number; expanded: boolean }[] = [];
    const maxSize = node.size;

    const addNode = (n: FileNode, depth: number) => {
      if (!matchesFilter(n)) return;

      const isExpanded = expandedPaths.has(n.path);
      rows.push({ node: n, depth, expanded: isExpanded });

      if (n.is_dir && isExpanded) {
        const sortedChildren = sortNodes(n.children);
        sortedChildren.forEach((child) => addNode(child, depth + 1));
      }
    };

    // Start from root's children (not root itself)
    const sortedChildren = sortNodes(node.children);
    sortedChildren.forEach((child) => addNode(child, 0));

    return { rows, maxSize };
  }, [node, expandedPaths, matchesFilter, sortNodes]);

  // Count totals
  const totalCount = useMemo(() => {
    let files = 0;
    let folders = 0;
    visibleRows.rows.forEach(({ node: n }) => {
      if (n.is_dir) folders++;
      else files++;
    });
    return { files, folders };
  }, [visibleRows.rows]);

  return (
    <div className="list-view">
      {/* Header */}
      <div className="list-header">
        <div className="list-header-left">
          <button className="list-expand-btn" onClick={expandAll} title="Expand all">
            ⊞
          </button>
          <button className="list-expand-btn" onClick={collapseAll} title="Collapse all">
            ⊟
          </button>
          <span className="list-stats">
            {totalCount.folders} folders, {totalCount.files} files
          </span>
        </div>
        <div className="list-column-headers">
          <span className="list-col-name">Name</span>
          <span className="list-col-type">Type</span>
          <span className="list-col-bar">Size</span>
          <span className="list-col-size">Size</span>
          <span className="list-col-date">Modified</span>
          <span className="list-col-count">Items</span>
        </div>
      </div>

      {/* Rows */}
      <div className="list-body" role="grid">
        {visibleRows.rows.map(({ node: rowNode, depth, expanded }) => (
          <ListRow
            key={rowNode.path}
            node={rowNode}
            depth={depth}
            expanded={expanded}
            onToggle={() => toggleExpand(rowNode.path)}
            onNavigate={onNavigate}
            onContextMenu={onContextMenu}
            onSelect={() => onSelect(rowNode)}
            isSelected={selectedPath === rowNode.path}
            searchText={searchText}
            maxSize={visibleRows.maxSize}
          />
        ))}
        {visibleRows.rows.length === 0 && (
          <div className="list-empty">
            No files match the current filters
          </div>
        )}
      </div>
    </div>
  );
});

ListView.displayName = "ListView";
