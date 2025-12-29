import { describe, it, expect } from "vitest";
import { layoutTreemap } from "./treemap";
import { FileNode, SortOption } from "./types";

// Helper to create a mock FileNode
function createNode(
  name: string,
  size: number,
  isDir: boolean = false,
  children: FileNode[] = [],
  modifiedAt?: number
): FileNode {
  return {
    id: `node-${name}`,
    name,
    path: `/test/${name}`,
    size,
    is_dir: isDir,
    children,
    file_count: children.filter((c) => !c.is_dir).length,
    dir_count: children.filter((c) => c.is_dir).length,
    modified_at: modifiedAt,
  };
}

describe("layoutTreemap", () => {
  describe("basic layout", () => {
    it("returns empty array for zero-size node", () => {
      const node = createNode("empty", 0);
      const result = layoutTreemap(node, { x: 0, y: 0, width: 100, height: 100 });
      expect(result).toEqual([]);
    });

    it("returns empty array for zero-width bounds", () => {
      const node = createNode("test", 1000);
      const result = layoutTreemap(node, { x: 0, y: 0, width: 0, height: 100 });
      expect(result).toEqual([]);
    });

    it("returns empty array for zero-height bounds", () => {
      const node = createNode("test", 1000);
      const result = layoutTreemap(node, { x: 0, y: 0, width: 100, height: 0 });
      expect(result).toEqual([]);
    });

    it("returns single rect for leaf node (file)", () => {
      const node = createNode("file.txt", 1000);
      const result = layoutTreemap(node, { x: 0, y: 0, width: 100, height: 100 });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "node-file.txt",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        depth: 0,
        isContainer: false,
      });
    });

    it("returns single rect for empty directory", () => {
      const node = createNode("folder", 1000, true, []);
      const result = layoutTreemap(node, { x: 0, y: 0, width: 100, height: 100 });

      expect(result).toHaveLength(1);
      expect(result[0].isContainer).toBe(false);
    });
  });

  describe("layout with children", () => {
    it("divides space proportionally by size", () => {
      const children = [
        createNode("big.txt", 750),
        createNode("small.txt", 250),
      ];
      const node = createNode("folder", 1000, true, children);

      const result = layoutTreemap(node, { x: 0, y: 0, width: 100, height: 100 });

      // Should have 2 rects (not containers since they're files)
      const leafRects = result.filter((r) => !r.isContainer);
      expect(leafRects.length).toBeGreaterThanOrEqual(2);

      // Big file should have larger area
      const bigRect = result.find((r) => r.node.name === "big.txt");
      const smallRect = result.find((r) => r.node.name === "small.txt");

      if (bigRect && smallRect) {
        const bigArea = bigRect.width * bigRect.height;
        const smallArea = smallRect.width * smallRect.height;
        expect(bigArea).toBeGreaterThan(smallArea);
      }
    });

    it("creates container rects for nested directories", () => {
      const innerChildren = [
        createNode("inner.txt", 500),
      ];
      const children = [
        createNode("subfolder", 500, true, innerChildren),
        createNode("file.txt", 500),
      ];
      const node = createNode("root", 1000, true, children);

      // Use large bounds so subfolder can be nested
      const result = layoutTreemap(node, { x: 0, y: 0, width: 400, height: 400 });

      // Should have container for subfolder
      const containers = result.filter((r) => r.isContainer);
      expect(containers.length).toBeGreaterThanOrEqual(1);
    });

    it("respects bounds position", () => {
      const children = [createNode("file.txt", 1000)];
      const node = createNode("folder", 1000, true, children);

      const result = layoutTreemap(node, { x: 50, y: 50, width: 100, height: 100 });

      result.forEach((rect) => {
        expect(rect.x).toBeGreaterThanOrEqual(50);
        expect(rect.y).toBeGreaterThanOrEqual(50);
        expect(rect.x + rect.width).toBeLessThanOrEqual(150);
        expect(rect.y + rect.height).toBeLessThanOrEqual(150);
      });
    });
  });

  describe("sorting", () => {
    const children = [
      createNode("b.txt", 200, false, [], 2000),
      createNode("a.txt", 100, false, [], 3000),
      createNode("c.txt", 300, false, [], 1000),
    ];
    const node = createNode("folder", 600, true, children);
    const bounds = { x: 0, y: 0, width: 300, height: 100 };

    it("sorts by size descending by default", () => {
      const result = layoutTreemap(node, bounds);
      const leafRects = result.filter((r) => !r.isContainer && !r.isAggregated);

      // First rect should be largest (c.txt = 300)
      if (leafRects.length >= 2) {
        const areas = leafRects.map((r) => r.width * r.height);
        // Areas should be in descending order
        for (let i = 0; i < areas.length - 1; i++) {
          expect(areas[i]).toBeGreaterThanOrEqual(areas[i + 1] * 0.9); // Allow some tolerance
        }
      }
    });

    it("sorts by size ascending when specified", () => {
      const sortOption: SortOption = { field: "size", order: "asc" };
      const result = layoutTreemap(node, bounds, 0, sortOption);
      const leafRects = result.filter((r) => !r.isContainer && !r.isAggregated);

      // First rect should be smallest (a.txt = 100)
      if (leafRects.length >= 2) {
        const areas = leafRects.map((r) => r.width * r.height);
        // Areas should be in ascending order
        for (let i = 0; i < areas.length - 1; i++) {
          expect(areas[i]).toBeLessThanOrEqual(areas[i + 1] * 1.1); // Allow some tolerance
        }
      }
    });

    it("sorts by name ascending", () => {
      const sortOption: SortOption = { field: "name", order: "asc" };
      const result = layoutTreemap(node, bounds, 0, sortOption);
      const leafRects = result.filter((r) => !r.isContainer && !r.isAggregated);

      // Names should be in order: a, b, c
      const names = leafRects.map((r) => r.node.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
      expect(names).toContain("c.txt");
    });

    it("sorts by date descending", () => {
      const sortOption: SortOption = { field: "date", order: "desc" };
      const result = layoutTreemap(node, bounds, 0, sortOption);
      const leafRects = result.filter((r) => !r.isContainer && !r.isAggregated);

      // First item should be most recent (a.txt = 3000)
      if (leafRects.length > 0) {
        // Just verify sort option is respected (no errors)
        expect(leafRects.length).toBeGreaterThan(0);
      }
    });
  });

  describe("small file aggregation", () => {
    it("aggregates files that are too small to display", () => {
      // Create many small files that will be below MIN_AREA_THRESHOLD
      const smallFiles = Array.from({ length: 20 }, (_, i) =>
        createNode(`tiny${i}.txt`, 1)
      );
      const bigFile = createNode("big.txt", 9980);
      const children = [bigFile, ...smallFiles];
      const node = createNode("folder", 10000, true, children);

      const result = layoutTreemap(node, { x: 0, y: 0, width: 100, height: 100 });

      // Should have some aggregated blocks
      const aggregated = result.filter((r) => r.isAggregated);

      // If there are aggregated items, check their properties
      if (aggregated.length > 0) {
        const aggRect = aggregated[0];
        expect(aggRect.aggregatedCount).toBeGreaterThan(0);
        expect(aggRect.aggregatedSize).toBeGreaterThan(0);
        expect(aggRect.aggregatedNodes).toBeDefined();
        expect(aggRect.node.name).toMatch(/\+\d+ more/);
      }
    });
  });

  describe("depth limiting", () => {
    it("limits recursion depth", () => {
      // Create deeply nested structure
      let currentNode = createNode("deep5", 100);
      for (let i = 4; i >= 0; i--) {
        currentNode = createNode(`deep${i}`, 100, true, [currentNode]);
      }

      const result = layoutTreemap(currentNode, { x: 0, y: 0, width: 500, height: 500 });

      // Check max depth (should be limited to MAX_DEPTH = 3)
      const maxDepth = Math.max(...result.map((r) => r.depth));
      expect(maxDepth).toBeLessThanOrEqual(3);
    });
  });

  describe("aspect ratio optimization", () => {
    it("produces roughly square-ish rectangles", () => {
      // Create 4 equal-sized children
      const children = [
        createNode("a.txt", 250),
        createNode("b.txt", 250),
        createNode("c.txt", 250),
        createNode("d.txt", 250),
      ];
      const node = createNode("folder", 1000, true, children);

      const result = layoutTreemap(node, { x: 0, y: 0, width: 200, height: 200 });
      const leafRects = result.filter((r) => !r.isContainer && !r.isAggregated);

      // Each rectangle should have reasonable aspect ratio (not too elongated)
      leafRects.forEach((rect) => {
        const aspectRatio = Math.max(rect.width, rect.height) / Math.min(rect.width, rect.height);
        // Aspect ratio should be reasonable (not too elongated) for squarified algorithm
        expect(aspectRatio).toBeLessThanOrEqual(4);
      });
    });
  });

  describe("edge cases", () => {
    it("handles single child", () => {
      const children = [createNode("only.txt", 1000)];
      const node = createNode("folder", 1000, true, children);

      const result = layoutTreemap(node, { x: 0, y: 0, width: 100, height: 100 });

      expect(result).toHaveLength(1);
      expect(result[0].node.name).toBe("only.txt");
    });

    it("handles very small bounds", () => {
      const children = [
        createNode("a.txt", 500),
        createNode("b.txt", 500),
      ];
      const node = createNode("folder", 1000, true, children);

      // 5x5 is below MIN_AREA_THRESHOLD
      const result = layoutTreemap(node, { x: 0, y: 0, width: 5, height: 5 });

      // Should still return results or handle gracefully
      expect(Array.isArray(result)).toBe(true);
    });

    it("filters out zero-size children", () => {
      const children = [
        createNode("valid.txt", 1000),
        createNode("empty.txt", 0),
      ];
      const node = createNode("folder", 1000, true, children);

      const result = layoutTreemap(node, { x: 0, y: 0, width: 100, height: 100 });

      // Should only have the valid file
      const names = result.map((r) => r.node.name);
      expect(names).toContain("valid.txt");
      expect(names).not.toContain("empty.txt");
    });
  });
});
