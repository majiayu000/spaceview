import React from "react";
import { FileNode, DiskSpaceInfo, formatSize } from "../types";

interface DiskOverviewProps {
  rootNode: FileNode;
  diskInfo: DiskSpaceInfo;
}

export const DiskOverview = React.memo(function DiskOverview({
  rootNode,
  diskInfo,
}: DiskOverviewProps) {
  return (
    <div className="disk-overview">
      <div className="disk-overview-bar">
        <div
          className="disk-overview-used"
          style={{ width: `${(diskInfo.used_bytes / diskInfo.total_bytes) * 100}%` }}
        >
          <div
            className="disk-overview-scanned"
            style={{ width: `${(rootNode.size / diskInfo.used_bytes) * 100}%` }}
          />
        </div>
      </div>
      <div className="disk-overview-stats">
        <div className="disk-overview-stat">
          <span className="disk-overview-label">Disk Total</span>
          <span className="disk-overview-value">{formatSize(diskInfo.total_bytes)}</span>
        </div>
        <div className="disk-overview-stat">
          <span className="disk-overview-label">Disk Used</span>
          <span className="disk-overview-value disk-used">{formatSize(diskInfo.used_bytes)}</span>
        </div>
        <div className="disk-overview-stat">
          <span className="disk-overview-label">Scanned</span>
          <span className="disk-overview-value disk-scanned">{formatSize(rootNode.size)}</span>
        </div>
        <div className="disk-overview-stat">
          <span className="disk-overview-label">Scanned %</span>
          <span className="disk-overview-value">{((rootNode.size / diskInfo.used_bytes) * 100).toFixed(1)}%</span>
        </div>
        <div className="disk-overview-stat">
          <span className="disk-overview-label">Available</span>
          <span className="disk-overview-value disk-available">{formatSize(diskInfo.available_bytes)}</span>
        </div>
      </div>
    </div>
  );
});
