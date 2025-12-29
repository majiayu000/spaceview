import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FilePreview, formatSize, getSyntaxLanguage } from "./types";

interface FilePreviewPanelProps {
  filePath: string;
  fileName: string;
  fileSize: number;
  onClose: () => void;
  onShowInFinder?: (path: string) => void;
  onOpenFile?: (path: string) => void;
}

export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  filePath,
  fileName,
  fileSize,
  onClose,
  onShowInFinder,
  onOpenFile,
}) => {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPreview = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<FilePreview>("get_file_preview", { path: filePath });
        setPreview(result);
      } catch (e) {
        setError(e as string);
      } finally {
        setLoading(false);
      }
    };
    loadPreview();
  }, [filePath]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const renderPreviewContent = () => {
    if (loading) {
      return (
        <div className="preview-loading">
          <div className="preview-spinner" />
          <span>Loading preview...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="preview-error">
          <span className="preview-error-icon">&#9888;</span>
          <span>{error}</span>
        </div>
      );
    }

    if (!preview) {
      return (
        <div className="preview-empty">
          <span>No preview available</span>
        </div>
      );
    }

    switch (preview.type) {
      case "image":
        return (
          <div className="preview-image-container">
            <img
              src={`data:${preview.mime_type};base64,${preview.data}`}
              alt={fileName}
              className="preview-image"
            />
            {(preview.width || preview.height) && (
              <div className="preview-image-info">
                {preview.width} x {preview.height}
              </div>
            )}
          </div>
        );

      case "text":
        return (
          <div className="preview-text-container">
            <div className="preview-text-header">
              <span className="preview-text-lang">{getSyntaxLanguage(preview.extension)}</span>
              <span className="preview-text-lines">
                {preview.lines} of {preview.total_lines} lines
              </span>
            </div>
            <pre className="preview-text-content">
              <code>{preview.content}</code>
            </pre>
            {preview.lines < preview.total_lines && (
              <div className="preview-text-truncated">
                ... {preview.total_lines - preview.lines} more lines
              </div>
            )}
          </div>
        );

      case "video":
        return (
          <div className="preview-video-container">
            {preview.thumbnail ? (
              <img
                src={`data:image/jpeg;base64,${preview.thumbnail}`}
                alt={`${fileName} thumbnail`}
                className="preview-video-thumbnail"
              />
            ) : (
              <div className="preview-video-placeholder">
                <span className="preview-video-icon">&#127916;</span>
                <span>Video Preview</span>
              </div>
            )}
            <div className="preview-video-info">
              {preview.duration && <span>Duration: {preview.duration}</span>}
              {preview.resolution && <span>Resolution: {preview.resolution}</span>}
            </div>
          </div>
        );

      case "audio":
        return (
          <div className="preview-audio-container">
            <div className="preview-audio-icon">&#127925;</div>
            <div className="preview-audio-info">
              {preview.duration && <span>Duration: {preview.duration}</span>}
              {preview.bitrate && <span>Bitrate: {preview.bitrate}</span>}
              {preview.sample_rate && <span>Sample Rate: {preview.sample_rate}</span>}
              {!preview.duration && !preview.bitrate && !preview.sample_rate && (
                <span>Audio file</span>
              )}
            </div>
          </div>
        );

      case "unsupported":
        return (
          <div className="preview-unsupported">
            <div className="preview-unsupported-icon">&#128196;</div>
            <div className="preview-unsupported-info">
              <span className="preview-unsupported-kind">{preview.kind}</span>
              {preview.extension && (
                <span className="preview-unsupported-ext">.{preview.extension}</span>
              )}
            </div>
            <span className="preview-unsupported-hint">
              Preview not available for this file type
            </span>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="preview-overlay" onClick={handleBackdropClick}>
      <div className="preview-panel">
        {/* Header */}
        <div className="preview-header">
          <div className="preview-header-info">
            <span className="preview-filename">{fileName}</span>
            <span className="preview-filesize">{formatSize(fileSize)}</span>
          </div>
          <div className="preview-header-actions">
            {onShowInFinder && (
              <button
                className="preview-action-btn"
                onClick={() => onShowInFinder(filePath)}
                title="Show in Finder"
              >
                &#128193;
              </button>
            )}
            {onOpenFile && (
              <button
                className="preview-action-btn"
                onClick={() => onOpenFile(filePath)}
                title="Open with default app"
              >
                &#128194;
              </button>
            )}
            <button
              className="preview-close-btn"
              onClick={onClose}
              title="Close (Escape)"
            >
              &#10005;
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="preview-content">
          {renderPreviewContent()}
        </div>

        {/* Footer */}
        <div className="preview-footer">
          <span className="preview-path" title={filePath}>
            {filePath}
          </span>
        </div>
      </div>
    </div>
  );
};
