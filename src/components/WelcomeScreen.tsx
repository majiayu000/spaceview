import React from "react";
import { ScanHistoryEntry, formatSize, formatDate } from "../types";

interface WelcomeScreenProps {
  scanHistory: ScanHistoryEntry[];
  onOpenFolder: () => void;
  onScanPath: (path: string) => void;
}

export const WelcomeScreen = React.memo(function WelcomeScreen({
  scanHistory,
  onOpenFolder,
  onScanPath,
}: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <div className="welcome-icon">&#128193;</div>
      <h1>SpaceView</h1>
      <p>Visualize your disk space usage</p>
      <button className="welcome-btn" onClick={onOpenFolder}>
        Open Folder
      </button>
      <div className="welcome-hint">Or press Cmd+O</div>

      {scanHistory.length > 0 && (
        <div className="scan-history">
          <h3>Recent Scans</h3>
          <div className="history-list">
            {scanHistory.slice(0, 5).map((entry, index) => (
              <button
                key={index}
                className="history-item"
                onClick={() => onScanPath(entry.scan_path)}
              >
                <div className="history-path">
                  <span className="history-icon">&#128193;</span>
                  {entry.scan_path.split("/").pop() || entry.scan_path}
                </div>
                <div className="history-meta">
                  <span className="history-size">{formatSize(entry.total_size)}</span>
                  <span className="history-time">{formatDate(entry.scanned_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
