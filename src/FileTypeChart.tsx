import React, { useMemo } from "react";
import { FileNode, FileType, FILE_TYPE_COLORS, FILE_TYPE_NAMES, getFileType, formatSize } from "./types";

interface FileTypeChartProps {
  node: FileNode;
}

interface TypeStats {
  type: FileType;
  size: number;
  count: number;
  percentage: number;
}

export const FileTypeChart: React.FC<FileTypeChartProps> = ({ node }) => {
  const stats = useMemo(() => {
    const typeMap = new Map<FileType, { size: number; count: number }>();

    // Initialize all types
    const allTypes: FileType[] = ["folder", "code", "image", "video", "audio", "archive", "document", "other"];
    allTypes.forEach(t => typeMap.set(t, { size: 0, count: 0 }));

    // Count files recursively
    const countFiles = (n: FileNode) => {
      const type = getFileType(n);
      const current = typeMap.get(type)!;
      current.size += n.size;
      current.count += 1;

      if (!n.is_dir) return;
      n.children.forEach(countFiles);
    };

    // Only count children, not the root itself
    node.children.forEach(countFiles);

    // Convert to array and calculate percentages
    const totalSize = Array.from(typeMap.values()).reduce((sum, v) => sum + v.size, 0);
    const result: TypeStats[] = allTypes
      .map(type => ({
        type,
        size: typeMap.get(type)!.size,
        count: typeMap.get(type)!.count,
        percentage: totalSize > 0 ? (typeMap.get(type)!.size / totalSize) * 100 : 0,
      }))
      .filter(s => s.size > 0)
      .sort((a, b) => b.size - a.size);

    return result;
  }, [node]);

  // Generate conic gradient for pie chart
  const gradient = useMemo(() => {
    let currentAngle = 0;
    const stops: string[] = [];

    stats.forEach(s => {
      const startAngle = currentAngle;
      const endAngle = currentAngle + (s.percentage / 100) * 360;
      stops.push(`${FILE_TYPE_COLORS[s.type]} ${startAngle}deg ${endAngle}deg`);
      currentAngle = endAngle;
    });

    return `conic-gradient(${stops.join(", ")})`;
  }, [stats]);

  if (stats.length === 0) return null;

  return (
    <div className="file-type-chart">
      <div className="chart-pie" style={{ background: gradient }} />
      <div className="chart-legend">
        {stats.slice(0, 6).map(s => (
          <div key={s.type} className="legend-item">
            <span className="legend-dot" style={{ background: FILE_TYPE_COLORS[s.type] }} />
            <span className="legend-name">{FILE_TYPE_NAMES[s.type]}</span>
            <span className="legend-size">{formatSize(s.size)}</span>
            <span className="legend-percent">{s.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};
