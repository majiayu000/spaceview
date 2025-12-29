import React from "react";
import { FileNode, formatSize } from "../types";

interface StatusBarProps {
  hoveredNode: FileNode | null;
  currentNode: FileNode | null;
}

export const StatusBar = React.memo(function StatusBar({
  hoveredNode,
  currentNode,
}: StatusBarProps) {
  const displayNode = hoveredNode || currentNode;

  if (!displayNode) return null;

  return (
    <div className="status-bar">
      <span className="status-bar-path">
        {displayNode.path}
      </span>
      <span className="status-bar-size">
        {formatSize(displayNode.size)}
      </span>
      {displayNode.is_dir && (
        <span>
          {displayNode.file_count.toLocaleString()} files,{" "}
          {displayNode.dir_count.toLocaleString()} folders
        </span>
      )}
    </div>
  );
});
