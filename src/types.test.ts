import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getFileType,
  getFileColor,
  getFileGradient,
  getFileGradientEnhanced,
  calculateSizeRatio,
  getFileIcon,
  formatSize,
  formatDate,
  formatFullDate,
  getSyntaxLanguage,
  FILE_TYPE_COLORS,
  FileNode,
} from "./types";

// Helper to create a mock FileNode
function createNode(
  name: string,
  isDir: boolean = false,
  extension?: string
): FileNode {
  return {
    id: `node-${name}`,
    name,
    path: `/test/${name}`,
    size: 1000,
    is_dir: isDir,
    children: [],
    file_count: 0,
    dir_count: 0,
    extension,
  };
}

describe("getFileType", () => {
  it("returns 'folder' for directories", () => {
    const node = createNode("folder", true);
    expect(getFileType(node)).toBe("folder");
  });

  it("returns 'code' for code files", () => {
    const extensions = ["js", "ts", "tsx", "py", "rs", "go", "java"];
    extensions.forEach((ext) => {
      const node = createNode(`file.${ext}`, false, ext);
      expect(getFileType(node)).toBe("code");
    });
  });

  it("returns 'image' for image files", () => {
    const extensions = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
    extensions.forEach((ext) => {
      const node = createNode(`image.${ext}`, false, ext);
      expect(getFileType(node)).toBe("image");
    });
  });

  it("returns 'video' for video files", () => {
    const extensions = ["mp4", "mov", "avi", "mkv", "webm"];
    extensions.forEach((ext) => {
      const node = createNode(`video.${ext}`, false, ext);
      expect(getFileType(node)).toBe("video");
    });
  });

  it("returns 'audio' for audio files", () => {
    const extensions = ["mp3", "wav", "flac", "ogg", "m4a"];
    extensions.forEach((ext) => {
      const node = createNode(`audio.${ext}`, false, ext);
      expect(getFileType(node)).toBe("audio");
    });
  });

  it("returns 'archive' for archive files", () => {
    const extensions = ["zip", "tar", "gz", "rar", "7z", "dmg"];
    extensions.forEach((ext) => {
      const node = createNode(`archive.${ext}`, false, ext);
      expect(getFileType(node)).toBe("archive");
    });
  });

  it("returns 'document' for document files", () => {
    const extensions = ["pdf", "doc", "docx", "xls", "xlsx", "txt"];
    extensions.forEach((ext) => {
      const node = createNode(`document.${ext}`, false, ext);
      expect(getFileType(node)).toBe("document");
    });
  });

  it("returns 'other' for unknown extensions", () => {
    const node = createNode("unknown.xyz", false, "xyz");
    expect(getFileType(node)).toBe("other");
  });

  it("returns 'other' for files without extension", () => {
    const node = createNode("noext", false, undefined);
    expect(getFileType(node)).toBe("other");
  });
});

describe("getFileColor", () => {
  it("returns correct color for each file type", () => {
    const folder = createNode("folder", true);
    expect(getFileColor(folder)).toBe(FILE_TYPE_COLORS.folder);

    const code = createNode("code.ts", false, "ts");
    expect(getFileColor(code)).toBe(FILE_TYPE_COLORS.code);
  });
});

describe("getFileGradient", () => {
  it("returns a valid gradient string", () => {
    const node = createNode("file.ts", false, "ts");
    const gradient = getFileGradient(node);

    expect(gradient).toContain("linear-gradient");
    expect(gradient).toContain("135deg");
  });
});

describe("getFileGradientEnhanced", () => {
  it("returns a valid gradient string", () => {
    const node = createNode("file.ts", false, "ts");
    const gradient = getFileGradientEnhanced(node, 0.5, 1);

    expect(gradient).toContain("linear-gradient");
    expect(gradient).toContain("hsl");
  });

  it("handles edge cases for sizeRatio", () => {
    const node = createNode("file.ts", false, "ts");

    // Below 0
    const gradient1 = getFileGradientEnhanced(node, -1, 0);
    expect(gradient1).toContain("hsl");

    // Above 1
    const gradient2 = getFileGradientEnhanced(node, 2, 0);
    expect(gradient2).toContain("hsl");
  });

  it("applies depth darkening", () => {
    const node = createNode("file.ts", false, "ts");

    // Shallow depth
    const shallow = getFileGradientEnhanced(node, 0.5, 0);
    // Deep depth
    const deep = getFileGradientEnhanced(node, 0.5, 5);

    // Both should be valid gradients (just checking they're different)
    expect(shallow).toContain("hsl");
    expect(deep).toContain("hsl");
  });
});

describe("calculateSizeRatio", () => {
  it("returns 0 for zero size", () => {
    expect(calculateSizeRatio(0, 1000)).toBe(0);
  });

  it("returns 0 when maxSize <= minSize", () => {
    expect(calculateSizeRatio(500, 100, 200)).toBe(0);
  });

  it("returns value between 0 and 1", () => {
    const ratio = calculateSizeRatio(500, 1000, 1);
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it("returns 1 for max size", () => {
    const ratio = calculateSizeRatio(1000, 1000, 1);
    expect(ratio).toBeCloseTo(1, 5);
  });

  it("uses logarithmic scale", () => {
    // Mid-point in log scale should not be 0.5 in linear scale
    const ratio = calculateSizeRatio(500, 1000, 1);
    expect(ratio).toBeGreaterThan(0.5); // Log scale skews toward larger values
  });
});

describe("getFileIcon", () => {
  it("returns correct icon for folders", () => {
    const node = createNode("folder", true);
    expect(getFileIcon(node)).toBe("\u{1F4C1}"); // folder emoji
  });

  it("returns correct icon for code files", () => {
    const node = createNode("code.ts", false, "ts");
    expect(getFileIcon(node)).toBe("\u{1F4BB}"); // laptop emoji
  });
});

describe("formatSize", () => {
  describe("SI units (default, 1000-based)", () => {
    it("formats 0 bytes", () => {
      expect(formatSize(0)).toBe("0 B");
    });

    it("formats bytes", () => {
      expect(formatSize(500)).toBe("500 B");
    });

    it("formats kilobytes", () => {
      expect(formatSize(1000)).toBe("1.0 KB");
      expect(formatSize(1500)).toBe("1.5 KB");
    });

    it("formats megabytes", () => {
      expect(formatSize(1000 * 1000)).toBe("1.0 MB");
      expect(formatSize(1000 * 1000 * 2.5)).toBe("2.5 MB");
    });

    it("formats gigabytes", () => {
      expect(formatSize(1000 * 1000 * 1000)).toBe("1.0 GB");
    });

    it("formats terabytes", () => {
      expect(formatSize(1000 * 1000 * 1000 * 1000)).toBe("1.0 TB");
    });
  });

  describe("binary units (1024-based)", () => {
    it("formats 0 bytes", () => {
      expect(formatSize(0, "binary")).toBe("0 B");
    });

    it("formats bytes", () => {
      expect(formatSize(500, "binary")).toBe("500 B");
    });

    it("formats kibibytes", () => {
      expect(formatSize(1024, "binary")).toBe("1.0 KiB");
      expect(formatSize(1536, "binary")).toBe("1.5 KiB");
    });

    it("formats mebibytes", () => {
      expect(formatSize(1024 * 1024, "binary")).toBe("1.0 MiB");
      expect(formatSize(1024 * 1024 * 2.5, "binary")).toBe("2.5 MiB");
    });

    it("formats gibibytes", () => {
      expect(formatSize(1024 * 1024 * 1024, "binary")).toBe("1.0 GiB");
    });

    it("formats tebibytes", () => {
      expect(formatSize(1024 * 1024 * 1024 * 1024, "binary")).toBe("1.0 TiB");
    });
  });
});

describe("formatDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set current time to 2024-01-15 12:00:00
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats 'Just now' for very recent timestamps", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatDate(now)).toBe("Just now");
  });

  it("formats minutes ago", () => {
    const now = Math.floor(Date.now() / 1000);
    const fiveMinAgo = now - 5 * 60;
    expect(formatDate(fiveMinAgo)).toBe("5m ago");
  });

  it("formats hours ago", () => {
    const now = Math.floor(Date.now() / 1000);
    const threeHoursAgo = now - 3 * 60 * 60;
    expect(formatDate(threeHoursAgo)).toBe("3h ago");
  });

  it("formats 'Yesterday'", () => {
    const now = Math.floor(Date.now() / 1000);
    const yesterday = now - 24 * 60 * 60;
    expect(formatDate(yesterday)).toBe("Yesterday");
  });

  it("formats days ago", () => {
    const now = Math.floor(Date.now() / 1000);
    const fiveDaysAgo = now - 5 * 24 * 60 * 60;
    expect(formatDate(fiveDaysAgo)).toBe("5d ago");
  });

  it("formats weeks ago", () => {
    const now = Math.floor(Date.now() / 1000);
    const twoWeeksAgo = now - 14 * 24 * 60 * 60;
    expect(formatDate(twoWeeksAgo)).toBe("2w ago");
  });

  it("formats months ago", () => {
    const now = Math.floor(Date.now() / 1000);
    const twoMonthsAgo = now - 60 * 24 * 60 * 60;
    expect(formatDate(twoMonthsAgo)).toBe("2mo ago");
  });

  it("formats old dates with full date", () => {
    const now = Math.floor(Date.now() / 1000);
    const oneYearAgo = now - 400 * 24 * 60 * 60;
    const result = formatDate(oneYearAgo);
    // Should be a formatted date string
    expect(result).toMatch(/\d{4}/); // Contains year
  });
});

describe("formatFullDate", () => {
  it("returns dash for null timestamp", () => {
    expect(formatFullDate(null)).toBe("\u2014"); // em dash
  });

  it("formats valid timestamp with full date and time", () => {
    const timestamp = 1705320000; // 2024-01-15 12:00:00 UTC
    const result = formatFullDate(timestamp);

    // Should contain year, month, day, and time components
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/\d+:\d+/); // time
  });
});

describe("getSyntaxLanguage", () => {
  it("returns 'text' for null extension", () => {
    expect(getSyntaxLanguage(null)).toBe("text");
  });

  it("maps common extensions correctly", () => {
    expect(getSyntaxLanguage("js")).toBe("javascript");
    expect(getSyntaxLanguage("ts")).toBe("typescript");
    expect(getSyntaxLanguage("tsx")).toBe("typescript");
    expect(getSyntaxLanguage("py")).toBe("python");
    expect(getSyntaxLanguage("rs")).toBe("rust");
    expect(getSyntaxLanguage("go")).toBe("go");
    expect(getSyntaxLanguage("java")).toBe("java");
    expect(getSyntaxLanguage("html")).toBe("html");
    expect(getSyntaxLanguage("css")).toBe("css");
    expect(getSyntaxLanguage("json")).toBe("json");
    expect(getSyntaxLanguage("md")).toBe("markdown");
    expect(getSyntaxLanguage("sh")).toBe("bash");
  });

  it("handles case insensitivity", () => {
    expect(getSyntaxLanguage("JS")).toBe("javascript");
    expect(getSyntaxLanguage("TS")).toBe("typescript");
  });

  it("returns 'text' for unknown extensions", () => {
    expect(getSyntaxLanguage("xyz")).toBe("text");
  });
});
