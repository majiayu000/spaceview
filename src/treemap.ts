import { FileNode, TreemapRect } from "./types";

/**
 * Squarified Treemap Layout Algorithm (SpaceSniffer-style)
 *
 * Key design principles:
 * 1. Folders are visible containers with borders
 * 2. Children are nested inside parent folders
 * 3. Deeper levels have smaller padding to preserve space
 * 4. Only recurse to show nested structure, keeping parent visible
 */

const MIN_AREA_THRESHOLD = 64; // Minimum visible area in pixels
const MAX_DEPTH = 3; // Maximum recursion depth
const HEADER_HEIGHT = 22; // Height for folder name header
const BASE_PADDING = 3; // Base padding for nesting

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutTreemap(
  node: FileNode,
  bounds: Rect,
  depth: number = 0
): TreemapRect[] {
  if (node.size === 0 || bounds.width < 1 || bounds.height < 1) {
    return [];
  }

  const children = [...node.children]
    .filter((c) => c.size > 0)
    .sort((a, b) => b.size - a.size);

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

  for (let i = 0; i < Math.min(children.length, rects.length); i++) {
    const child = children[i];
    const rect = rects[i];

    // Skip if too small to display
    if (rect.width * rect.height < MIN_AREA_THRESHOLD) {
      continue;
    }

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
        results.push(...layoutTreemap(child, innerRect, depth + 1));
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
