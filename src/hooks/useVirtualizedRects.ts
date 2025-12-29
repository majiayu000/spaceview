import { useMemo } from "react";
import { TreemapRect } from "../types";

interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface UseVirtualizedRectsOptions {
  rects: TreemapRect[];
  containerWidth: number;
  containerHeight: number;
  zoom: number;
  pan: { x: number; y: number };
  /**
   * Extra padding around viewport (in pixels) to pre-render cells
   * that are about to become visible during panning/zooming
   */
  overscan?: number;
  /**
   * Enable virtualization. When false, all rects are returned.
   * Useful for debugging or when virtualization causes issues.
   */
  enabled?: boolean;
}

interface VirtualizedRectsResult {
  visibleRects: TreemapRect[];
  visibleIndices: number[];
  totalCount: number;
  visibleCount: number;
}

/**
 * Hook to virtualize treemap rects by filtering only those visible in the viewport.
 * Takes into account zoom and pan transformations.
 *
 * Performance: This significantly reduces DOM nodes when viewing large treemaps,
 * especially at high zoom levels where only a portion of the treemap is visible.
 */
export function useVirtualizedRects({
  rects,
  containerWidth,
  containerHeight,
  zoom,
  pan,
  overscan = 100,
  enabled = true,
}: UseVirtualizedRectsOptions): VirtualizedRectsResult {
  const result = useMemo(() => {
    // If virtualization is disabled or container has no dimensions, return all rects
    if (!enabled || containerWidth <= 0 || containerHeight <= 0) {
      return {
        visibleRects: rects,
        visibleIndices: rects.map((_, i) => i),
        totalCount: rects.length,
        visibleCount: rects.length,
      };
    }

    // Calculate viewport bounds in treemap coordinate space
    // The treemap is transformed by: translate(pan.x, pan.y) scale(zoom)
    // So to find what's visible, we need to inverse transform the viewport
    const viewport: ViewportBounds = {
      left: (-pan.x - overscan) / zoom,
      top: (-pan.y - overscan) / zoom,
      right: (containerWidth - pan.x + overscan) / zoom,
      bottom: (containerHeight - pan.y + overscan) / zoom,
    };

    // Filter rects that intersect with the viewport
    const visibleRects: TreemapRect[] = [];
    const visibleIndices: number[] = [];

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];

      // Check if rect intersects with viewport
      // A rect intersects if it's not completely outside the viewport
      const rectRight = rect.x + rect.width;
      const rectBottom = rect.y + rect.height;

      const isVisible =
        rect.x < viewport.right &&
        rectRight > viewport.left &&
        rect.y < viewport.bottom &&
        rectBottom > viewport.top;

      if (isVisible) {
        visibleRects.push(rect);
        visibleIndices.push(i);
      }
    }

    return {
      visibleRects,
      visibleIndices,
      totalCount: rects.length,
      visibleCount: visibleRects.length,
    };
  }, [rects, containerWidth, containerHeight, zoom, pan, overscan, enabled]);

  return result;
}

/**
 * Helper to map a visible index back to the original rect index
 */
export function mapVisibleIndexToOriginal(
  visibleIndex: number,
  visibleIndices: number[]
): number {
  return visibleIndices[visibleIndex] ?? -1;
}

/**
 * Helper to map an original rect index to the visible index
 */
export function mapOriginalIndexToVisible(
  originalIndex: number,
  visibleIndices: number[]
): number {
  return visibleIndices.indexOf(originalIndex);
}
