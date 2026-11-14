import fs from 'fs';
import path from 'path';

/**
 * Returns the configured base directory for uploaded resumes & JDs.
 * Defaults to E:/Srinivas/upload_resumes if not set.
 */
export function getUploadBaseDir(): string {
  const dir = process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes';
  return path.resolve(dir);
}

/**
 * Ensures all required queue directories exist recursively.
 */
export function ensureUploadDirs(): {
  base: string;
  incomingCandidates: string;
  incomingJobs: string;
  processed: string;
  failed: string;
} {
  const base = getUploadBaseDir();
  const incomingCandidates = path.join(base, 'incoming', 'candidates');
  const incomingJobs = path.join(base, 'incoming', 'jobs');
  const processed = path.join(base, 'processed');
  const failed = path.join(base, 'failed');

  [incomingCandidates, incomingJobs, processed, failed].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  return { base, incomingCandidates, incomingJobs, processed, failed };
}

/**
 * Sanitizes a file name by removing characters like ~, #, %, &, spaces,
 * and unsafe path characters while preserving extension.
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName) return 'unnamed_file';

  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);

  // Replace special characters (~ # % & spaces, quotes, etc.) with underscores
  const safeBase = baseName
    .replace(/[~#%&+\s\/\\:;*?"<>|]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();

  return `${safeBase || 'file'}${safeExt || ''}`;
}

/**
 * Saves an uploaded buffer into the incoming directory:
 *   <UPLOAD_DIR>/incoming/<type>/<batchId>_<timestamp>_<safeName>
 * Returns the absolute saved file path.
 */
export async function saveFileToIncoming(
  buffer: Buffer,
  originalFileName: string,
  type: 'candidate' | 'job',
  batchId: string
): Promise<{ filePath: string; safeFileName: string }> {
  const { incomingCandidates, incomingJobs } = ensureUploadDirs();
  const targetDir = type === 'candidate' ? incomingCandidates : incomingJobs;

  const safeName = sanitizeFileName(originalFileName);
  const timestamp = Date.now();
  const savedFileName = `${batchId}_${timestamp}_${safeName}`;
  const filePath = path.join(targetDir, savedFileName);

  await fs.promises.writeFile(filePath, buffer);

  return { filePath, safeFileName: savedFileName };
}

/**
 * Moves a file from its current path to the "processed" or "failed" directory.
 * If target exists, appends timestamp to prevent collisions.
 * Returns the new path.
 */
export async function moveFile(
  currentFilePath: string,
  destination: 'processed' | 'failed'
): Promise<string | null> {
  if (!currentFilePath || !fs.existsSync(currentFilePath)) {
    console.warn(`[upload-storage] moveFile: File does not exist at "${currentFilePath}"`);
    return null;
  }

  const { processed, failed } = ensureUploadDirs();
  const targetDir = destination === 'processed' ? processed : failed;

  const fileName = path.basename(currentFilePath);
  let destinationPath = path.join(targetDir, fileName);

  // If a file with the same name already exists in destination, append timestamp
  if (fs.existsSync(destinationPath)) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    destinationPath = path.join(targetDir, `${base}_${Date.now()}${ext}`);
  }

  try {
    await fs.promises.rename(currentFilePath, destinationPath);
  } catch (err: any) {
    // If cross-device link error (EXDEV on Windows across partitions), fallback to copy + unlink
    if (err.code === 'EXDEV') {
      await fs.promises.copyFile(currentFilePath, destinationPath);
      await fs.promises.unlink(currentFilePath);
    } else {
      throw err;
    }
  }

  return destinationPath;
}

