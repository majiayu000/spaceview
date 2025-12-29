import React from "react";
import { FileNode } from "../types";

interface ContextMenuProps {
  x: number;
  y: number;
  node: FileNode;
  onShowInFinder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onCopyPath: (path: string) => void;
  onOpenInTerminal: (path: string) => void;
  onMoveToTrash: (path: string) => void;
  onPreview: (node: FileNode) => void;
  onClose: () => void;
}

export const ContextMenu = React.memo(function ContextMenu({
  x,
  y,
  node,
  onShowInFinder,
  onOpenFile,
  onCopyPath,
  onOpenInTerminal,
  onMoveToTrash,
  onPreview,
  onClose,
}: ContextMenuProps) {
  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          onShowInFinder(node.path);
          onClose();
        }}
      >
        <span>&#128193;</span> Show in Finder
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          onOpenFile(node.path);
          onClose();
        }}
      >
        <span>&#128194;</span> Open
      </div>
      {!node.is_dir && (
        <div
          className="context-menu-item"
          onClick={() => {
            onPreview(node);
            onClose();
          }}
        >
          <span>&#128065;</span> Preview
        </div>
      )}
      <div className="context-menu-divider" />
      <div
        className="context-menu-item"
        onClick={() => {
          onCopyPath(node.path);
          onClose();
        }}
      >
        <span>&#128203;</span> Copy Path
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          onOpenInTerminal(node.path);
          onClose();
        }}
      >
        <span>&#9002;</span> Open in Terminal
      </div>
      <div className="context-menu-divider" />
      <div
        className="context-menu-item danger"
        onClick={() => {
          onMoveToTrash(node.path);
          onClose();
        }}
      >
        <span>&#128465;</span> Move to Trash
      </div>
    </div>
  );
});
