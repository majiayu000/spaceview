import { FileNode, TreemapRect, SortOption } from "./types";

/**
 * Squarified Treemap Layout Algorithm (SpaceSniffer-style)
 *
 * Key design principles:
 * 1. Folders are visible containers with borders
 * 2. Children are nested inside parent folders
 * 3. Deeper levels have smaller padding to preserve space
 * 4. Only recurse to show nested structure, keeping parent visible
 */

const MIN_AREA_THRESHOLD = 16; // Minimum visible area in pixels
const MAX_DEPTH = 3; // Maximum recursion depth
const HEADER_HEIGHT = 22; // Height for folder name header
const BASE_PADDING = 3; // Base padding for nesting
const MIN_AGGREGATED_COUNT = 2; // Minimum items to show aggregated block
const AGGREGATED_PREVIEW_COUNT = 5; // Max items to store for preview
const ALWAYS_SHOW_COUNT = 30; // Always render at least this many largest children per level

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Helper function to sort children based on sort option
function sortChildren(children: FileNode[], sortOption?: SortOption): FileNode[] {
  const sorted = [...children].filter((c) => c.size > 0);

  if (!sortOption) {
    // Default: sort by size descending (largest first for treemap)
    return sorted.sort((a, b) => b.size - a.size);
  }

  const { field, order } = sortOption;
  const multiplier = order === 'asc' ? 1 : -1;

  return sorted.sort((a, b) => {
    switch (field) {
      case 'size':
        return (a.size - b.size) * multiplier;
      case 'name':
        return a.name.localeCompare(b.name) * multiplier;
      case 'date':
        // Use modified_at timestamp, fallback to 0 if not available
        const aTime = a.modified_at ?? 0;
        const bTime = b.modified_at ?? 0;
        return (aTime - bTime) * multiplier;
      default:
        return (b.size - a.size); // Fallback to size desc
    }
  });
}

export function layoutTreemap(
  node: FileNode,
  bounds: Rect,
  depth: number = 0,
  sortOption?: SortOption
): TreemapRect[] {
  if (node.size === 0 || bounds.width < 1 || bounds.height < 1) {
    return [];
  }

  const children = sortChildren(node.children, sortOption);

  if (children.length === 0) {
    // Leaf node (file or empty directory)
    return [
      {
        id: node.id,
        node,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        depth,
        isContainer: false,
      },
    ];
  }

  const totalSize = children.reduce((sum, c) => sum + c.size, 0);
  if (totalSize === 0) return [];

  // Calculate areas proportional to size
  const areas = children.map(
    (c) => (c.size / totalSize) * bounds.width * bounds.height
  );

  // Run squarify algorithm
  const rects = squarify(areas, bounds);

  // Build result
  const results: TreemapRect[] = [];
  const skippedNodes: FileNode[] = [];
  let skippedSize = 0;
  let lastValidRect: Rect | null = null;

  for (let i = 0; i < Math.min(children.length, rects.length); i++) {
    const child = children[i];
    const rect = rects[i];

    const area = rect.width * rect.height;
    const isProtected = i < ALWAYS_SHOW_COUNT;
    // Collect small items instead of skipping (unless protected)
    if (!isProtected && area < MIN_AREA_THRESHOLD) {
      skippedNodes.push(child);
      skippedSize += child.size;
      // Track the last valid rect position for aggregated block placement
      if (!lastValidRect && i > 0) {
        lastValidRect = rects[i - 1];
      }
      continue;
    }

    lastValidRect = rect;

    const canNest =
      child.is_dir &&
      depth < MAX_DEPTH &&
      child.children.length > 0 &&
      rect.width > 60 &&
      rect.height > 50;

    if (canNest) {
      // Add the folder itself as a container
      results.push({
        id: child.id,
        node: child,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        depth,
        isContainer: true,
      });

      // Calculate inner area for children (with padding and header)
      const padding = Math.max(2, BASE_PADDING - depth);
      const headerH = rect.height > 80 ? HEADER_HEIGHT : 0;
      const innerRect = {
        x: rect.x + padding,
        y: rect.y + headerH + padding,
        width: rect.width - padding * 2,
        height: rect.height - headerH - padding * 2,
      };

      // Only recurse if inner area is usable
      if (innerRect.width > 20 && innerRect.height > 20) {
        results.push(...layoutTreemap(child, innerRect, depth + 1, sortOption));
      }
    } else {
      // Show as leaf (file or folder that's too small to nest)
      results.push({
        id: child.id,
        node: child,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        depth,
        isContainer: false,
      });
    }
  }

  // Create aggregated block for skipped small items
  if (skippedNodes.length >= MIN_AGGREGATED_COUNT && skippedSize > 0) {
    // Calculate remaining area for aggregated block
    const aggregatedArea = (skippedSize / totalSize) * bounds.width * bounds.height;

    // Only show aggregated block if it has reasonable size
    if (aggregatedArea >= MIN_AREA_THRESHOLD / 2) {
      // Find position for aggregated block (at the end of bounds)
      // Use the remaining space after all regular items
      const usedWidth = results
        .filter(r => r.depth === depth && !r.isContainer)
        .reduce((max, r) => Math.max(max, r.x + r.width - bounds.x), 0);
      const usedHeight = results
        .filter(r => r.depth === depth && !r.isContainer)
        .reduce((max, r) => Math.max(max, r.y + r.height - bounds.y), 0);

      // Calculate aggregated block dimensions
      // Use aspect ratio similar to bounds
      const aspectRatio = bounds.width / bounds.height;
      let aggWidth = Math.sqrt(aggregatedArea * aspectRatio);
      let aggHeight = aggregatedArea / aggWidth;

      // Clamp to minimum visible size
      aggWidth = Math.max(aggWidth, 40);
      aggHeight = Math.max(aggHeight, 30);

      // Position in bottom-right corner of remaining space
      let aggX = bounds.x + bounds.width - aggWidth;
      let aggY = bounds.y + bounds.height - aggHeight;

      // Make sure it doesn't overlap with existing content too much
      // Find a suitable position
      if (bounds.width >= bounds.height) {
        // Horizontal layout - place at right edge
        aggX = bounds.x + Math.max(usedWidth, bounds.width - aggWidth);
        aggY = bounds.y;
        aggHeight = bounds.height;
        aggWidth = Math.max(bounds.width - usedWidth, aggWidth);
      } else {
        // Vertical layout - place at bottom edge
        aggX = bounds.x;
        aggY = bounds.y + Math.max(usedHeight, bounds.height - aggHeight);
        aggWidth = bounds.width;
        aggHeight = Math.max(bounds.height - usedHeight, aggHeight);
      }

      // Ensure minimum size
      if (aggWidth >= 30 && aggHeight >= 25) {
        // Create a placeholder node for the aggregated block
        const aggregatedNode: FileNode = {
          id: `aggregated-${depth}-${bounds.x}-${bounds.y}`,
          name: `+${skippedNodes.length} more`,
          path: "",
          size: skippedSize,
          is_dir: false,
          children: [],
          file_count: skippedNodes.length,
          dir_count: 0,
        };

        results.push({
          id: aggregatedNode.id,
          node: aggregatedNode,
          x: aggX,
          y: aggY,
          width: aggWidth,
          height: aggHeight,
          depth,
          isContainer: false,
          isAggregated: true,
          aggregatedNodes: skippedNodes.slice(0, AGGREGATED_PREVIEW_COUNT),
          aggregatedCount: skippedNodes.length,
          aggregatedSize: skippedSize,
        });
      }
    }
  }

  return results;
}

/**
 * Squarify algorithm implementation
 */
function squarify(areas: number[], bounds: Rect): Rect[] {
  if (areas.length === 0) return [];

  const rects: Rect[] = [];
  let remainingBounds = { ...bounds };
  let currentRow: number[] = [];
  let currentRowArea = 0;

  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    const testRow = [...currentRow, area];
    const testRowArea = currentRowArea + area;

    const currentWorst =
      currentRow.length === 0
        ? Infinity
        : worstAspectRatio(currentRow, currentRowArea, remainingBounds);
    const testWorst = worstAspectRatio(testRow, testRowArea, remainingBounds);

    if (currentRow.length === 0 || testWorst <= currentWorst) {
      currentRow = testRow;
      currentRowArea = testRowArea;
    } else {
      const { rowRects, newBounds } = layoutRow(
        currentRow,
        currentRowArea,
        remainingBounds
      );
      rects.push(...rowRects);
      remainingBounds = newBounds;

      currentRow = [area];
      currentRowArea = area;
    }
  }

  if (currentRow.length > 0) {
    const { rowRects } = layoutRow(currentRow, currentRowArea, remainingBounds);
    rects.push(...rowRects);
  }

  return rects;
}

function worstAspectRatio(
  row: number[],
  rowArea: number,
  bounds: Rect
): number {
  if (row.length === 0 || rowArea === 0) return Infinity;

  const isHorizontal = bounds.width >= bounds.height;
  const sideLength = isHorizontal ? bounds.height : bounds.width;

  if (sideLength === 0) return Infinity;

  const rowLength = rowArea / sideLength;

  let worst = 0;
  for (const area of row) {
    const itemLength = area / rowLength;
    const aspectRatio = Math.max(
      itemLength / sideLength,
      sideLength / itemLength
    );
    worst = Math.max(worst, aspectRatio);
  }

  return worst;
}

function layoutRow(
  row: number[],
  rowArea: number,
  bounds: Rect
): { rowRects: Rect[]; newBounds: Rect } {
  if (row.length === 0) {
    return { rowRects: [], newBounds: bounds };
  }

  const isHorizontal = bounds.width >= bounds.height;
  const sideLength = isHorizontal ? bounds.height : bounds.width;
  const rowLength = sideLength > 0 ? rowArea / sideLength : 0;

  const rowRects: Rect[] = [];
  let offset = 0;

  for (const area of row) {
    const itemLength = rowLength > 0 ? area / rowLength : 0;

    if (isHorizontal) {
      rowRects.push({
        x: bounds.x,
        y: bounds.y + offset,
        width: rowLength,
        height: itemLength,
      });
    } else {
      rowRects.push({
        x: bounds.x + offset,
        y: bounds.y,
        width: itemLength,
        height: rowLength,
      });
    }

    offset += itemLength;
  }

  let newBounds: Rect;
  if (isHorizontal) {
    newBounds = {
      x: bounds.x + rowLength,
      y: bounds.y,
      width: bounds.width - rowLength,
      height: bounds.height,
    };
  } else {
    newBounds = {
      x: bounds.x,
      y: bounds.y + rowLength,
      width: bounds.width,
      height: bounds.height - rowLength,
    };
  }

  return { rowRects, newBounds };
}
