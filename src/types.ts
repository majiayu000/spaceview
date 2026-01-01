// Application settings (matches Rust Settings struct)
export interface Settings {
  version: number;
  max_scan_depth: number | null;
  ignore_patterns: string[];
  show_hidden_files: boolean;
  size_unit: "si" | "binary";
  default_theme: string | null;
  enable_cache: boolean;
  auto_expand_large_files: boolean;
  large_files_count: number;
  duplicate_min_size: number;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  max_scan_depth: null,
  ignore_patterns: [".git", ".svn", ".hg", "node_modules", ".DS_Store", "Thumbs.db"],
  show_hidden_files: false,
  size_unit: "si",
  default_theme: null,
  enable_cache: true,
  auto_expand_large_files: false,
  large_files_count: 20,
  duplicate_min_size: 1024,
};

export interface FileNode {
  id: string;
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  children: FileNode[];
  extension?: string;
  file_count: number;
  dir_count: number;
  modified_at?: number;  // Unix timestamp in seconds
}

export interface Favorite {
  path: string;
  name: string;
  is_dir: boolean;
  added_at: number;
}

// Deleted item for undo functionality
export interface DeletedItem {
  name: string;
  original_path: string;
  parent_path: string;
  is_dir: boolean;
  deleted_at: number;  // Unix timestamp in seconds
}

export interface ScanProgress {
  scanned_files: number;
  scanned_dirs: number;
  current_path: string;
  total_size: number;
  is_complete: boolean;
  phase: string;  // "walking" | "relations" | "sizes" | "tree" | "complete"
}

export interface DiskSpaceInfo {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  mount_point: string;
}

export interface CacheInfo {
  cache_path: string;
  cached_at: number;
  cache_size_bytes: number;
}

export interface CachedScan {
  version: number;
  scan_path: string;
  scanned_at: number;
  last_incremental_at?: number;
  total_files: number;
  total_dirs: number;
  total_size: number;
  root: FileNode;
}

export interface ScanHistoryEntry {
  scan_path: string;
  scanned_at: number;
  total_files: number;
  total_dirs: number;
  total_size: number;
  cache_size_bytes: number;
}

export interface DuplicateFile {
  path: string;
  name: string;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: DuplicateFile[];
  wasted_bytes: number;
}

export interface DuplicateResult {
  groups: DuplicateGroup[];
  total_duplicates: number;
  total_wasted_bytes: number;
  files_scanned: number;
  files_hashed: number;
  full_hash_files: number;
  partial_collision_groups: number;
  time_ms: number;
}

export interface DuplicateProgress {
  phase: string;  // "scanning" | "grouping" | "hashing" | "complete"
  scanned_files: number;
  groups_found: number;
  files_hashed: number;
  total_to_hash: number;
  current_file: string;
  is_complete: boolean;
}

export interface CompareFile {
  path: string;
  relative_path: string;
  name: string;
  size: number;
  is_dir: boolean;
}

export interface DiffFile {
  relative_path: string;
  name: string;
  left_size: number;
  right_size: number;
  left_path: string;
  right_path: string;
  left_is_dir: boolean;
  right_is_dir: boolean;
}

export interface CompareProgress {
  phase: string;  // "scanning_left" | "scanning_right" | "comparing" | "complete"
  left_files: number;
  right_files: number;
  compared_files: number;
  total_to_compare: number;
  current_file: string;
  is_complete: boolean;
}

export interface CompareResult {
  left_path: string;
  right_path: string;
  left_only: CompareFile[];
  right_only: CompareFile[];
  different: DiffFile[];
  identical_count: number;
  left_only_size: number;
  right_only_size: number;
  different_size: number;
  type_conflict_count: number;
  type_conflict_size: number;
  time_ms: number;
}

// Cleanable files types
export type CleanableCategory =
  | "dependencies"
  | "build_output"
  | "cache"
  | "logs"
  | "temporary"
  | "ide_files"
  | "vcs_artifacts"
  | "system_files";

export interface CleanableItem {
  path: string;
  name: string;
  size: number;
  category: CleanableCategory;
  is_dir: boolean;
  pattern_name: string;
  description: string;
  risk_level: string; // "low" | "medium" | "high"
  file_count: number;
}

export interface CleanableResult {
  items: CleanableItem[];
  total_size: number;
  size_by_category: Record<string, number>;
  count_by_category: Record<string, number>;
  duration_ms: number;
  files_scanned: number;
}

export interface CleanableProgress {
  phase: string; // "scanning" | "complete"
  items_found: number;
  total_size: number;
  current_path: string;
  is_complete: boolean;
}

export const CLEANABLE_CATEGORY_NAMES: Record<CleanableCategory, string> = {
  dependencies: "Dependencies",
  build_output: "Build Output",
  cache: "Caches",
  logs: "Logs",
  temporary: "Temporary",
  ide_files: "IDE Files",
  vcs_artifacts: "VCS Artifacts",
  system_files: "System Files",
};

export const CLEANABLE_CATEGORY_ICONS: Record<CleanableCategory, string> = {
  dependencies: "📦",
  build_output: "🏗️",
  cache: "💾",
  logs: "📝",
  temporary: "⏳",
  ide_files: "🛠️",
  vcs_artifacts: "📂",
  system_files: "⚙️",
};

export const CLEANABLE_CATEGORY_COLORS: Record<CleanableCategory, string> = {
  dependencies: "#3b82f6", // blue
  build_output: "#f59e0b", // amber
  cache: "#8b5cf6", // purple
  logs: "#6b7280", // gray
  temporary: "#ef4444", // red
  ide_files: "#10b981", // green
  vcs_artifacts: "#f97316", // orange
  system_files: "#64748b", // slate
};

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  is_dir: boolean;
  is_symlink: boolean;
  created_at: number | null;
  modified_at: number | null;
  accessed_at: number | null;
  permissions: string | null;
  owner: string | null;
  group: string | null;
  file_count: number | null;
  extension: string | null;
  kind: string;
}

export interface DeleteLogEntry {
  id: number;
  scan_path: string;
  target_path: string;
  size_bytes: number;
  deleted_at: number;
}

export interface WatcherStatus {
  active: boolean;
  path: string;
  error?: string;
}

export interface IncrementalStatus {
  phase: "start" | "complete";
  updated: boolean;
  full_rescan: boolean;
  dirty_count: number;
  at: number;
}

export interface TreemapRect {
  id: string;
  node: FileNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  isContainer: boolean;
  isAggregated?: boolean;        // True if this is an aggregated "more items" block
  aggregatedNodes?: FileNode[];  // List of nodes that were aggregated
  aggregatedCount?: number;      // Total count of aggregated items
  aggregatedSize?: number;       // Total size of aggregated items
}

// Sorting options for treemap display
export type SortField = 'size' | 'name' | 'date';
export type SortOrder = 'asc' | 'desc';

export interface SortOption {
  field: SortField;
  order: SortOrder;
}

export const SORT_LABELS: Record<SortField, string> = {
  size: 'Size',
  name: 'Name',
  date: 'Date Modified',
};

export type FileType =
  | "folder"
  | "code"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "document"
  | "other";

// Color palette designed for:
// 1. Color-blind accessibility (different luminance levels)
// 2. High contrast with white text (4.5:1+ ratio)
// 3. Semantic meaning association
// 4. Dark theme compatibility
export const FILE_TYPE_COLORS: Record<FileType, string> = {
  folder: "#3b82f6",   // Blue - container/organization
  code: "#10b981",     // Emerald - creation/life
  image: "#8b5cf6",    // Purple - creativity/visual
  video: "#ef4444",    // Red - media/intensity
  audio: "#ec4899",    // Pink - music/emotion
  archive: "#f97316",  // Orange - packed/bundled
  document: "#06b6d4", // Cyan - information/knowledge
  other: "#6b7280",    // Gray - neutral
};

// Gradient colors for depth effect
export const FILE_TYPE_GRADIENTS: Record<FileType, [string, string]> = {
  folder: ["#3b82f6", "#2563eb"],
  code: ["#10b981", "#059669"],
  image: ["#8b5cf6", "#7c3aed"],
  video: ["#ef4444", "#dc2626"],
  audio: ["#ec4899", "#db2777"],
  archive: ["#f97316", "#ea580c"],
  document: ["#06b6d4", "#0891b2"],
  other: ["#6b7280", "#4b5563"],
};

// HSL base colors for size-based color variations
// Using HSL allows easy brightness/saturation adjustments
export const FILE_TYPE_HSL: Record<FileType, { h: number; s: number; l: number }> = {
  folder: { h: 217, s: 91, l: 60 },   // Blue
  code: { h: 160, s: 84, l: 39 },     // Emerald
  image: { h: 258, s: 90, l: 66 },    // Purple
  video: { h: 0, s: 84, l: 60 },      // Red
  audio: { h: 330, s: 81, l: 60 },    // Pink
  archive: { h: 25, s: 95, l: 53 },   // Orange
  document: { h: 189, s: 94, l: 43 }, // Cyan
  other: { h: 220, s: 9, l: 46 },     // Gray
};

export const FILE_TYPE_NAMES: Record<FileType, string> = {
  folder: "Folders",
  code: "Code",
  image: "Images",
  video: "Videos",
  audio: "Audio",
  archive: "Archives",
  document: "Documents",
  other: "Other",
};

const CODE_EXTENSIONS = new Set([
  "swift", "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java",
  "kt", "c", "cpp", "h", "hpp", "cs", "php", "html", "css", "scss",
  "json", "xml", "yaml", "yml", "md", "sh", "bash", "zsh"
]);

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp", "svg", "ico",
  "heic", "heif", "raw", "psd", "ai"
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "avi", "mkv", "wmv", "flv", "webm", "m4v", "mpeg", "mpg", "3gp"
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "aac", "flac", "ogg", "wma", "m4a", "aiff", "alac"
]);

const ARCHIVE_EXTENSIONS = new Set([
  "zip", "tar", "gz", "rar", "7z", "bz2", "xz", "dmg", "iso", "pkg"
]);

const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf",
  "odt", "ods", "odp", "pages", "numbers", "keynote"
]);

export function getFileType(node: FileNode): FileType {
  if (node.is_dir) return "folder";

  const ext = node.extension?.toLowerCase() || "";

  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";

  return "other";
}

export function getFileColor(node: FileNode): string {
  return FILE_TYPE_COLORS[getFileType(node)];
}

export function getFileGradient(node: FileNode): string {
  const [from, to] = FILE_TYPE_GRADIENTS[getFileType(node)];
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}

/**
 * Enhanced gradient with size-based brightness variation
 * Large files appear brighter/more saturated, small files appear darker
 *
 * @param node - The file node
 * @param sizeRatio - Ratio of file size relative to max size (0-1), use logarithmic scale recommended
 * @param depth - Nesting depth for additional darkening
 */
export function getFileGradientEnhanced(
  node: FileNode,
  sizeRatio: number = 1,
  depth: number = 0
): string {
  const fileType = getFileType(node);
  const baseHsl = FILE_TYPE_HSL[fileType];

  // Clamp sizeRatio to 0-1 range
  const ratio = Math.max(0, Math.min(1, sizeRatio));

  // Calculate lightness adjustment based on size ratio
  // Large files: +5 lightness, Small files: -15 lightness
  // Use logarithmic curve for more natural distribution
  const lightnessBoost = ratio * 20 - 15; // Range: -15 to +5

  // Saturation slightly increases for larger files
  const saturationBoost = ratio * 10 - 5; // Range: -5 to +5

  // Depth darkening: each level reduces lightness slightly
  const depthDarkening = Math.min(depth * 3, 12); // Max 12% darker for deep items

  // Calculate final values with bounds checking
  const l1 = Math.max(20, Math.min(75, baseHsl.l + lightnessBoost - depthDarkening));
  const l2 = Math.max(15, Math.min(70, l1 - 8)); // End color is slightly darker
  const s = Math.max(30, Math.min(100, baseHsl.s + saturationBoost));
  const h = baseHsl.h;

  return `linear-gradient(135deg, hsl(${h}, ${s}%, ${l1}%) 0%, hsl(${h}, ${s}%, ${l2}%) 100%)`;
}

/**
 * Calculate size ratio using logarithmic scale for better visual distribution
 * This prevents very small files from being too dark
 */
export function calculateSizeRatio(size: number, maxSize: number, minSize: number = 1): number {
  if (maxSize <= minSize || size <= 0) return 0;

  // Use log scale for better visual distribution
  const logSize = Math.log(Math.max(size, 1));
  const logMax = Math.log(maxSize);
  const logMin = Math.log(Math.max(minSize, 1));

  if (logMax <= logMin) return 0;

  return Math.max(0, Math.min(1, (logSize - logMin) / (logMax - logMin)));
}

// Icons for file types (using emoji for simplicity, can be replaced with SVG)
export const FILE_TYPE_ICONS: Record<FileType, string> = {
  folder: "📁",
  code: "💻",
  image: "🖼️",
  video: "🎬",
  audio: "🎵",
  archive: "📦",
  document: "📄",
  other: "📎",
};

export function getFileIcon(node: FileNode): string {
  return FILE_TYPE_ICONS[getFileType(node)];
}

/**
 * Format bytes to human-readable size string
 * @param bytes - Size in bytes
 * @param unit - Unit format: "si" for 1000-based (KB, MB), "binary" for 1024-based (KiB, MiB)
 */
export function formatSize(bytes: number, unit: "si" | "binary" = "si"): string {
  if (bytes === 0) return "0 B";

  if (unit === "binary") {
    // Binary units: 1024-based (IEC standard)
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${units[Math.min(i, units.length - 1)]}`;
  } else {
    // SI units: 1000-based (default, matches macOS Finder)
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    const k = 1000;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${units[Math.min(i, units.length - 1)]}`;
  }
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // For recent dates, show relative time
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return "Just now";
      return `${diffMins}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;

  // For older dates, show formatted date
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatFullDate(timestamp: number | null): string {
  if (timestamp === null) return "—";
  const date = new Date(timestamp * 1000);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// File Preview types
export interface ImagePreview {
  type: "image";
  data: string;          // Base64 encoded image data
  mime_type: string;     // e.g., "image/png"
  width: number | null;
  height: number | null;
}

export interface TextPreview {
  type: "text";
  content: string;       // Text content (first N lines)
  lines: number;         // Number of lines included
  total_lines: number;   // Total lines in file
  extension: string | null;
}

export interface VideoPreview {
  type: "video";
  thumbnail: string | null;  // Base64 encoded thumbnail
  duration: string | null;
  resolution: string | null;
}

export interface AudioPreview {
  type: "audio";
  duration: string | null;
  bitrate: string | null;
  sample_rate: string | null;
}

export interface UnsupportedPreview {
  type: "unsupported";
  kind: string;
  extension: string | null;
}

export type FilePreview = ImagePreview | TextPreview | VideoPreview | AudioPreview | UnsupportedPreview;

// Get syntax language from extension for code highlighting
export function getSyntaxLanguage(extension: string | null): string {
  if (!extension) return "text";
  const ext = extension.toLowerCase();
  const langMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    swift: "swift",
    kt: "kotlin",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
  };
  return langMap[ext] || "text";
}

// ============================================================================
// Snapshot Comparison Types (for scan result comparison over time)
// ============================================================================

export interface SnapshotEntry {
  scan_path: string;
  timestamp: number;
  total_files: number;
  total_dirs: number;
  total_size: number;
  snapshot_size_bytes: number;
}

export interface SnapshotFile {
  path: string;
  name: string;
  size: number;
  is_dir: boolean;
  modified: number;
}

export interface ChangedFile {
  path: string;
  name: string;
  old_size: number;
  new_size: number;
  size_diff: number;
  is_dir: boolean;
}

export interface SnapshotCompareResult {
  scan_path: string;
  old_timestamp: number;
  new_timestamp: number;
  added: SnapshotFile[];
  removed: SnapshotFile[];
  changed: ChangedFile[];
  added_size: number;
  removed_size: number;
  net_size_change: number;
  unchanged_count: number;
  time_ms: number;
}
