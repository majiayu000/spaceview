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

export interface TreemapRect {
  id: string;
  node: FileNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  isContainer: boolean;
}

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

export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
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
