import React, { useEffect, useCallback, useRef } from "react";

interface KeyboardShortcutsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { key: string; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { key: "↑ ↓ ← →", description: "Navigate between cells" },
      { key: "Enter", description: "Enter selected folder" },
      { key: "Backspace", description: "Go back to parent folder" },
      { key: "Escape", description: "Deselect / Close menu" },
    ],
  },
  {
    title: "File Operations",
    shortcuts: [
      { key: "⌘O", description: "Open folder to scan" },
      { key: "Space", description: "Quick Look preview" },
      { key: "⌘⌫", description: "Move to Trash" },
    ],
  },
  {
    title: "Search",
    shortcuts: [
      { key: "⌘F", description: "Focus search box" },
      { key: "Enter", description: "Next search result (in search)" },
      { key: "⇧Enter", description: "Previous search result" },
      { key: "F3 / ⌘G", description: "Next search result" },
      { key: "⇧F3 / ⇧⌘G", description: "Previous search result" },
    ],
  },
  {
    title: "View",
    shortcuts: [
      { key: "⌘+Scroll", description: "Zoom in/out" },
      { key: "⌥+Drag", description: "Pan view" },
      { key: "Middle Drag", description: "Pan view" },
    ],
  },
  {
    title: "Other",
    shortcuts: [
      { key: "⌘,", description: "Open Settings" },
      { key: "?", description: "Show this help" },
    ],
  },
];

export const KeyboardShortcutsPanel: React.FC<KeyboardShortcutsPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
      // Focus trap - keep focus inside the modal
      if (e.key === "Tab" && panelRef.current) {
        const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      // Store the previously focused element
      previousActiveElement.current = document.activeElement as HTMLElement;
      // Focus the close button when modal opens
      setTimeout(() => closeButtonRef.current?.focus(), 0);
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    } else {
      // Restore focus when modal closes
      previousActiveElement.current?.focus();
    }
  }, [isOpen, handleKeyDown]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="keyboard-shortcuts-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
      >
        <div className="shortcuts-header">
          <h2 id="shortcuts-dialog-title">Keyboard Shortcuts</h2>
          <button
            ref={closeButtonRef}
            className="modal-close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close keyboard shortcuts dialog"
          >
            ✕
          </button>
        </div>
        <div className="shortcuts-content">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-group">
              <h3 className="shortcuts-group-title">{group.title}</h3>
              <div className="shortcuts-list">
                {group.shortcuts.map((shortcut, idx) => (
                  <div key={idx} className="shortcut-item">
                    <kbd className="shortcut-key">{shortcut.key}</kbd>
                    <span className="shortcut-description">{shortcut.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="shortcuts-footer">
          <span className="shortcuts-hint">Press <kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsPanel;
