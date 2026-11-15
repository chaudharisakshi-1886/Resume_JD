export const runtime = 'nodejs';

import '@/utils/dns-fix';
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { pool } from '@/database/db';
import { extractText } from '@/lib/resume-processing';
import { updateBatchStatus } from '@/services/batchService';

// In-process lock to prevent overlapping runs within the same instance
let isQueueProcessing = false;

// Supported file extensions for queue documents
const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.doc', '.txt']);

function isSupportedFile(fileName: string): boolean {
  if (fileName.endsWith('.error.txt')) return false;
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTS.has(ext);
}

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
function parseFileName(
  fileName: string,
  defaultBatchPrefix: 'batch_job_folder' | 'batch_cand_folder' = 'batch_cand_folder'
): {
  userId: string;
  batchId: string;
  safeName: string;
} {
  const adminUserId = process.env.ADMIN_USER_ID || 'seeded-admin-user-id';
  const sep1 = fileName.indexOf('__');
  if (sep1 === -1) {
    return { userId: adminUserId, batchId: `${defaultBatchPrefix}_${Date.now()}`, safeName: fileName };
  }
  const sep2 = fileName.indexOf('__', sep1 + 2);
  if (sep2 === -1) {
    return {
      userId: fileName.slice(0, sep1) || adminUserId,
      batchId: `${defaultBatchPrefix}_${Date.now()}`,
      safeName: fileName.slice(sep1 + 2) || fileName,
    };
  }
  return {
    userId: fileName.slice(0, sep1) || adminUserId,
    batchId: fileName.slice(sep1 + 2, sep2) || `${defaultBatchPrefix}_${Date.now()}`,
    safeName: fileName.slice(sep2 + 2) || fileName,
  };
}

// ---------------------------------------------------------------------------
// POST /api/internal/process-queue
// Protected by x-secret header matching CRON_SECRET.
// Scans incoming/jobs BEFORE incoming/candidates so jobs exist before resumes.
// Dispatches files to their respective n8n webhooks, then moves to processed/ or failed/.
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

    // Track job metrics
    let jobsFound = 0;
    let jobsProcessed = 0;
    let jobsFailed = 0;
    let jobsSkipped = 0;

    // Track resume metrics
    let resumesFound = 0;
    let resumesProcessed = 0;
    let resumesFailed = 0;
    let resumesSkipped = 0;

    try {
      const baseDir = (process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes').replace(/\\/g, '/');
      const jobsIncomingDir = path.join(baseDir, 'incoming', 'jobs');
      const candidatesIncomingDir = path.join(baseDir, 'incoming', 'candidates');
      const failedDir = path.join(baseDir, 'failed');

      // Ensure directories exist
      await fs.promises.mkdir(jobsIncomingDir, { recursive: true });
      await fs.promises.mkdir(candidatesIncomingDir, { recursive: true });
      await fs.promises.mkdir(failedDir, { recursive: true });

      const n8nSecret = process.env.N8N_SHARED_SECRET || '';
      const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
      const callbackUrl = `${appBaseUrl}/api/webhooks/n8n/batch-complete`;

      const jobWebhookUrl = (
        process.env.N8N_JD_WEBHOOK_URL ||
        process.env.NEXT_PUBLIC_N8N_JD_WEBHOOK_URL ||
        ''
      ).trim();

      const candidateWebhookUrl = (
        process.env.N8N_CANDIDATE_RESUME_WEBHOOK_URL ||
        process.env.NEXT_PUBLIC_N8N_CANDIDATE_RESUME_WEBHOOK_URL ||
        ''
      ).trim();

      // =====================================================================
      // 3. Process JOB DESCRIPTIONS FIRST (resumes need their job to exist)
      // =====================================================================
      let jobEntries: string[] = [];
      try {
        jobEntries = await fs.promises.readdir(jobsIncomingDir);
      } catch {
        jobEntries = [];
      }

      const jobFileNames = jobEntries.filter(isSupportedFile);
      jobsFound = jobFileNames.length;

      for (const fileName of jobFileNames) {
        const filePath = path.join(jobsIncomingDir, fileName);

        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(filePath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) continue;

        // Skip files modified in the last 60 seconds (may still be copying)
        if (Date.now() - stat.mtimeMs < 60_000) {
          jobsSkipped++;
          console.log(`[ProcessQueue] Skipping job "${fileName}" — modified less than 60s ago.`);
          continue;
        }

        const { userId, batchId, safeName } = parseFileName(fileName, 'batch_job_folder');

        try {
          // Read buffer
          const buffer = await fs.promises.readFile(filePath);

          // Extract text using same extractText as realtime flow
          const extracted = await extractText(buffer, safeName);
          const rawText = (extracted.text || '').trim();

          if (!rawText) {
            throw new Error(`Failed to extract readable text from "${safeName}". File appears empty or corrupted.`);
          }

          // Extract position_id: from safeName (after user ID prefix removed) and from text
          const codeMatch =
            safeName.match(/(J\d{3,4}|ADM-\d{3}|[A-Z]{2,5}-\d{2,4})/i) ||
            rawText.match(/(?:Job Code|Position ID|Req ID|Code)[\s:-]+([A-Z0-9-]+)/i);
          const positionId = codeMatch ? codeMatch[1].trim() : null;

          if (!positionId) {
            throw new Error('position ID not found in job description');
          }

          // Check if position_id already exists in job_descriptions (case-insensitive)
          const existingJob = await pool.query(
            `SELECT id FROM job_descriptions WHERE lower(job_code) = lower($1) LIMIT 1`,
            [positionId]
          );

          if (existingJob.rows.length > 0) {
            throw new Error('job already exists');
          }

          // Update batch status to 'processing' only if batch record exists
          try {
            const batchCheck = await pool.query(
              `SELECT id FROM upload_batches WHERE id = $1 LIMIT 1`,
              [batchId]
            );
            if (batchCheck.rows.length > 0) {
              await updateBatchStatus(batchId, {
                status: 'processing',
                message: `Processing job file "${safeName}"…`,
              });
            }
          } catch (batchErr: any) {
            console.warn(`[ProcessQueue] Could not update batch "${batchId}": ${batchErr.message}`);
          }

          // Build exact realtime job description payload shape
          const payload = {
            batch_id: batchId,
            batchId,
            user_id: userId,
            userId,
            created_by: userId,
            createdBy: userId,
            job_descriptions: [
              {
                position_id: positionId,
                file_name: safeName,
                file_type: extracted.fileType || 'application/pdf',
                text: rawText,
                wordCount: extracted.wordCount ?? rawText.split(/\s+/).filter(Boolean).length,
                charCount: extracted.charCount ?? rawText.length,
              },
            ],
            callback_url: callbackUrl,
          };

          // Dispatch to job n8n webhook — no timeout, redirect: 'manual'
          if (jobWebhookUrl) {
            const webhookRes = await fetch(jobWebhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': n8nSecret,
              },
              body: JSON.stringify(payload),
              redirect: 'manual',
            });

            if (webhookRes.status >= 300 && webhookRes.status < 400) {
              const errBody = await webhookRes.text().catch(() => '');
              throw new Error(
                `n8n webhook returned redirect ${webhookRes.status}: ${errBody.slice(0, 500) || 'no body'}`
              );
            }
            if (!webhookRes.ok) {
              const errBody = await webhookRes.text().catch(() => '');
              throw new Error(
                `n8n webhook returned HTTP ${webhookRes.status}: ${errBody.slice(0, 500) || 'Unknown error'}`
              );
            }
          } else {
            console.warn(`[ProcessQueue] N8N_JD_WEBHOOK_URL is not set. Skipping webhook dispatch for "${safeName}".`);
          }

          // 2xx -> move to processed/
          await moveFileWithTimestamp(filePath, 'processed');
          jobsProcessed++;
          console.log(`[ProcessQueue] ✓ Processed job "${fileName}" → processed/`);
        } catch (itemErr: any) {
          console.error(`[ProcessQueue] ✗ Error processing job "${fileName}":`, itemErr.message);

          // Move to failed/ and write error file
          try {
            await moveFileWithTimestamp(filePath, 'failed');
          } catch (moveErr: any) {
            console.error(`[ProcessQueue] Could not move "${fileName}" to failed/:`, moveErr.message);
          }

          const errorFilePath = path.join(failedDir, `${fileName}.error.txt`);
          try {
            await fs.promises.writeFile(errorFilePath, `${itemErr.message}\n`);
          } catch (writeErr: any) {
            console.error(`[ProcessQueue] Could not write error file for "${fileName}":`, writeErr.message);
          }

          jobsFailed++;
        }
      }

      // =====================================================================
      // 4. Process CANDIDATE RESUMES NEXT (runs even if jobs had errors)
      // =====================================================================
      let resumeEntries: string[] = [];
      try {
        resumeEntries = await fs.promises.readdir(candidatesIncomingDir);
      } catch {
        resumeEntries = [];
      }

      const candidateFileNames = resumeEntries.filter(isSupportedFile);
      resumesFound = candidateFileNames.length;

      for (const fileName of candidateFileNames) {
        const filePath = path.join(candidatesIncomingDir, fileName);

        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(filePath);
        } catch {
          continue;
        }
        if (stat.isDirectory()) continue;

        // Skip files modified in the last 60 seconds (may still be copying)
        if (Date.now() - stat.mtimeMs < 60_000) {
          resumesSkipped++;
          console.log(`[ProcessQueue] Skipping candidate "${fileName}" — modified less than 60s ago.`);
          continue;
        }

        const { userId, batchId, safeName } = parseFileName(fileName, 'batch_cand_folder');

        try {
          // Read buffer
          const buffer = await fs.promises.readFile(filePath);

          // Extract text
          const extracted = await extractText(buffer, safeName);
          const rawText = (extracted.text || '').trim();

          if (!rawText) {
            throw new Error(`Failed to extract readable text from "${safeName}". File appears empty or corrupted.`);
          }

          // Update batch status to 'processing' only if batch record exists
          try {
            const batchCheck = await pool.query(
              `SELECT id FROM upload_batches WHERE id = $1 LIMIT 1`,
              [batchId]
            );
            if (batchCheck.rows.length > 0) {
              await updateBatchStatus(batchId, {
                status: 'processing',
                message: `Processing file "${safeName}"…`,
              });
            }
          } catch (batchErr: any) {
            console.warn(`[ProcessQueue] Could not update batch "${batchId}": ${batchErr.message}`);
          }

          // Build candidate resume payload
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
            callback_url: callbackUrl,
          };

          // Dispatch to candidate n8n webhook — no timeout, redirect: 'manual'
          if (candidateWebhookUrl) {
            const webhookRes = await fetch(candidateWebhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': n8nSecret,
              },
              body: JSON.stringify(payload),
              redirect: 'manual',
            });

            if (webhookRes.status >= 300 && webhookRes.status < 400) {
              const errBody = await webhookRes.text().catch(() => '');
              throw new Error(
                `n8n webhook returned redirect ${webhookRes.status}: ${errBody.slice(0, 500) || 'no body'}`
              );
            }
            if (!webhookRes.ok) {
              const errBody = await webhookRes.text().catch(() => '');
              throw new Error(
                `n8n webhook returned HTTP ${webhookRes.status}: ${errBody.slice(0, 500) || 'Unknown error'}`
              );
            }
          } else {
            console.warn(`[ProcessQueue] N8N_CANDIDATE_RESUME_WEBHOOK_URL is not set. Skipping webhook dispatch for "${safeName}".`);
          }

          // Move to processed/
          await moveFileWithTimestamp(filePath, 'processed');
          resumesProcessed++;
          console.log(`[ProcessQueue] ✓ Processed resume "${fileName}" → processed/`);
        } catch (itemErr: any) {
          console.error(`[ProcessQueue] ✗ Error processing resume "${fileName}":`, itemErr.message);

          // Move to failed/ and write error file
          try {
            await moveFileWithTimestamp(filePath, 'failed');
          } catch (moveErr: any) {
            console.error(`[ProcessQueue] Could not move "${fileName}" to failed/:`, moveErr.message);
          }

          const errorFilePath = path.join(failedDir, `${fileName}.error.txt`);
          try {
            await fs.promises.writeFile(errorFilePath, `${itemErr.message}\n`);
          } catch (writeErr: any) {
            console.error(`[ProcessQueue] Could not write error file for "${fileName}":`, writeErr.message);
          }

          resumesFailed++;
        }
      }

      return NextResponse.json({
        jobs: {
          found: jobsFound,
          processed: jobsProcessed,
          failed: jobsFailed,
          skipped: jobsSkipped,
        },
        resumes: {
          found: resumesFound,
          processed: resumesProcessed,
          failed: resumesFailed,
          skipped: resumesSkipped,
        },
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
