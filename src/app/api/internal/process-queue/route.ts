export const runtime = 'nodejs';

import '@/utils/dns-fix';
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { extractText } from '@/lib/resume-processing';
import { updateBatchStatus } from '@/services/batchService';

// In-process lock to prevent overlapping runs within the same instance
let isQueueProcessing = false;

// ---------------------------------------------------------------------------
// Helper: move a file to processed/ or failed/, adding a timestamp suffix if
// a file with the same name already exists at the destination.
// Handles cross-device moves (EXDEV) by copy + unlink.
// ---------------------------------------------------------------------------
async function moveFileWithTimestamp(
  sourcePath: string,
  dest: 'processed' | 'failed'
): Promise<void> {
  const baseDir = (process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes').replace(/\\/g, '/');
  const destDir = path.join(baseDir, dest);
  await fs.promises.mkdir(destDir, { recursive: true });

  const baseName = path.basename(sourcePath);
  let destPath = path.join(destDir, baseName);

  if (fs.existsSync(destPath)) {
    const ext = path.extname(baseName);
    const stem = baseName.slice(0, baseName.length - ext.length);
    destPath = path.join(destDir, `${stem}_${Date.now()}${ext}`);
  }

  try {
    await fs.promises.rename(sourcePath, destPath);
  } catch (e: any) {
    if (e.code === 'EXDEV') {
      // Cross-device: copy then delete original
      await fs.promises.copyFile(sourcePath, destPath);
      await fs.promises.unlink(sourcePath);
    } else {
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: parse userId, batchId, safeName from the file name.
// Convention: <userId>__<batchId>__<safeName>
// Split on first two '__' only so safeName may itself contain '__'.
// Falls back to ADMIN_USER_ID and a generated batchId when segments are missing.
// ---------------------------------------------------------------------------
function parseFileName(fileName: string): {
  userId: string;
  batchId: string;
  safeName: string;
} {
  const adminUserId = process.env.ADMIN_USER_ID || 'seeded-admin-user-id';
  const sep1 = fileName.indexOf('__');
  if (sep1 === -1) {
    return { userId: adminUserId, batchId: `folder_${Date.now()}`, safeName: fileName };
  }
  const sep2 = fileName.indexOf('__', sep1 + 2);
  if (sep2 === -1) {
    return {
      userId: fileName.slice(0, sep1) || adminUserId,
      batchId: `folder_${Date.now()}`,
      safeName: fileName.slice(sep1 + 2) || fileName,
    };
  }
  return {
    userId: fileName.slice(0, sep1) || adminUserId,
    batchId: fileName.slice(sep1 + 2, sep2),
    safeName: fileName.slice(sep2 + 2) || fileName,
  };
}

// ---------------------------------------------------------------------------
// POST /api/internal/process-queue
// Protected by x-secret header matching CRON_SECRET.
// Reads files from UPLOAD_DIR/incoming/candidates, dispatches each to the
// n8n candidate resume webhook, then moves to processed/ or failed/.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    // 1. Authorization: x-secret header must match CRON_SECRET
    const providedSecret = (request.headers.get('x-secret') || '').trim();
    const expectedSecret = (process.env.CRON_SECRET || '').trim();

    if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Forbidden: Invalid or missing secret' }, { status: 403 });
    }

    // 2. Prevent overlapping runs
    if (isQueueProcessing) {
      return NextResponse.json(
        { message: 'Queue processing is already in progress. Skipping run.' },
        { status: 429 }
      );
    }

    isQueueProcessing = true;

    let processedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    try {
      const baseDir = (process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes').replace(/\\/g, '/');
      const incomingDir = path.join(baseDir, 'incoming', 'candidates');
      const failedDir = path.join(baseDir, 'failed');

      // Ensure directories exist
      await fs.promises.mkdir(incomingDir, { recursive: true });
      await fs.promises.mkdir(failedDir, { recursive: true });

      // 3. Read directory
      let entries: string[];
      try {
        entries = await fs.promises.readdir(incomingDir);
      } catch {
        entries = [];
      }

      // Filter to files only (skip .error.txt, skip directories)
      const fileNames = entries.filter((e) => !e.endsWith('.error.txt'));

      if (fileNames.length === 0) {
        return NextResponse.json({ message: 'No files in incoming/candidates folder.', processed: 0, failed: 0, skipped: 0 });
      }

      const webhookUrl = (
        process.env.N8N_CANDIDATE_RESUME_WEBHOOK_URL ||
        process.env.NEXT_PUBLIC_N8N_CANDIDATE_RESUME_WEBHOOK_URL ||
        ''
      ).trim();

      const n8nSecret = process.env.N8N_SHARED_SECRET || '';
      const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').trim();

      // 4. Process each file one at a time
      for (const fileName of fileNames) {
        const filePath = path.join(incomingDir, fileName);

        // Skip directories
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(filePath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) continue;

        // Skip files modified in the last 60 seconds (may still be writing)
        if (Date.now() - stat.mtimeMs < 60_000) {
          skippedCount++;
          console.log(`[ProcessQueue] Skipping "${fileName}" — modified less than 60s ago.`);
          continue;
        }

        const { userId, batchId, safeName } = parseFileName(fileName);

        try {
          // Read buffer
          const buffer = await fs.promises.readFile(filePath);

          // Extract text
          const extracted = await extractText(buffer, safeName);
          const rawText = (extracted.text || '').trim();

          if (!rawText) {
            throw new Error(`Failed to extract readable text from "${safeName}". File appears empty or corrupted.`);
          }

          // Mark batch as 'processing' (n8n batch-complete callback will set 'completed')
          try {
            await updateBatchStatus(batchId, {
              status: 'processing',
              message: `Processing file "${safeName}"…`,
            });
          } catch (batchErr: any) {
            // Batch may not exist for files dropped directly in the folder — log and continue
            console.warn(`[ProcessQueue] Could not update batch "${batchId}": ${batchErr.message}`);
          }

          // Build n8n payload (same structure as processCandidateBatchAsync)
          const payload = {
            batch_id: batchId,
            batchId,
            user_id: userId,
            userId,
            created_by: userId,
            createdBy: userId,
            resumes: [
              {
                file_name: safeName,
                file_type: extracted.fileType || 'application/pdf',
                text: rawText,
              },
            ],
            callback_url: `${appBaseUrl}/api/webhooks/n8n/batch-complete`,
          };

          // Dispatch to n8n
          if (webhookUrl) {
            const webhookRes = await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': n8nSecret,
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(25000),
              redirect: 'manual',
            });

            // 3xx redirects count as errors
            if (webhookRes.status >= 300 && webhookRes.status < 400) {
              throw new Error(`n8n webhook returned redirect ${webhookRes.status}`);
            }
            if (!webhookRes.ok) {
              const errBody = await webhookRes.text().catch(() => '');
              throw new Error(`n8n webhook returned HTTP ${webhookRes.status}: ${errBody || 'Unknown error'}`);
            }
          } else {
            console.warn(`[ProcessQueue] N8N_CANDIDATE_RESUME_WEBHOOK_URL is not set. Skipping webhook dispatch for "${safeName}".`);
          }

          // Move to processed/
          await moveFileWithTimestamp(filePath, 'processed');
          processedCount++;
          console.log(`[ProcessQueue] ✓ Processed "${fileName}" → processed/`);
        } catch (itemErr: any) {
          console.error(`[ProcessQueue] ✗ Error processing "${fileName}":`, itemErr.message);

          // Move to failed/ and write error file
          try {
            await moveFileWithTimestamp(filePath, 'failed');
          } catch (moveErr: any) {
            console.error(`[ProcessQueue] Could not move "${fileName}" to failed/:`, moveErr.message);
          }

          const errorFilePath = path.join(failedDir, `${fileName}.error.txt`);
          try {
            await fs.promises.writeFile(
              errorFilePath,
              `Error processing "${fileName}" at ${new Date().toISOString()}:\n${itemErr.message}\n`
            );
          } catch (writeErr: any) {
            console.error(`[ProcessQueue] Could not write error file for "${fileName}":`, writeErr.message);
          }

          failedCount++;
        }
      }

      return NextResponse.json({
        processed: processedCount,
        failed: failedCount,
        skipped: skippedCount,
        total_found: fileNames.length,
      });
    } finally {
      isQueueProcessing = false;
    }
  } catch (error: any) {
    isQueueProcessing = false;
    console.error('[ProcessQueue] Unexpected fatal error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
