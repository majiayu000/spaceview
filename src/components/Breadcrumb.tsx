import React from "react";
import { FileNode } from "../types";

interface BreadcrumbProps {
  rootNode: FileNode;
  navigationPath: FileNode[];
  onNavigateToRoot: () => void;
  onNavigateToIndex: (index: number) => void;
}

export const Breadcrumb = React.memo(function Breadcrumb({
  rootNode,
  navigationPath,
  onNavigateToRoot,
  onNavigateToIndex,
}: BreadcrumbProps) {
  return (
    <nav className="breadcrumb" aria-label="Folder navigation">
      <button
        className={`breadcrumb-item ${navigationPath.length === 0 ? "active" : ""}`}
        onClick={onNavigateToRoot}
        aria-current={navigationPath.length === 0 ? "location" : undefined}
      >
        <span aria-hidden="true">&#128193;</span> {rootNode.name}
      </button>
      {navigationPath.map((node, index) => (
        <span key={node.id}>
          <span className="breadcrumb-separator" aria-hidden="true">&#8250;</span>
          <button
            className={`breadcrumb-item ${index === navigationPath.length - 1 ? "active" : ""}`}
            onClick={() => onNavigateToIndex(index)}
            aria-current={index === navigationPath.length - 1 ? "location" : undefined}
          >
            <span aria-hidden="true">&#128193;</span> {node.name}
          </button>
        </span>
      ))}
    </nav>
  );
});
