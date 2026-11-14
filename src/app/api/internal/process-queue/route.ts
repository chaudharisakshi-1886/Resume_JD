import '@/utils/dns-fix';
import fs from 'fs';
import { NextResponse } from 'next/server';
import { pool } from '@/database/db';
import { extractText } from '@/lib/resume-processing';
import { moveFile } from '@/lib/upload-storage';
import { updateBatchStatus } from '@/services/batchService';

// In-process lock to prevent overlapping runs within the same instance
let isQueueProcessing = false;

export async function POST(request: Request) {
  try {
    // 1. Authorization check: header "x-secret" must equal CRON_SECRET
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
    const affectedBatchIds = new Set<string>();

    try {
      // 3. Reset rows stuck in 'processing' for more than 30 minutes back to 'pending'
      await pool.query(`
        UPDATE upload_queue
        SET status = 'pending'
        WHERE status = 'processing'
          AND created_at < NOW() - INTERVAL '30 minutes'
      `);

      // 4. Claim up to 50 pending rows atomically using FOR UPDATE SKIP LOCKED
      const claimResult = await pool.query(`
        UPDATE upload_queue
        SET status = 'processing'
        WHERE id IN (
          SELECT id FROM upload_queue
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 50
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *;
      `);

      const rows = claimResult.rows;

      if (!rows || rows.length === 0) {
        return NextResponse.json({
          message: 'No pending items in queue.',
          processed: 0,
          failed: 0,
        });
      }

      const secret = process.env.N8N_SHARED_SECRET || '';

      // 5. Process claimed rows ONE AT A TIME
      for (const row of rows) {
        affectedBatchIds.add(row.batch_id);

        try {
          // Check physical file existence
          if (!fs.existsSync(row.file_path)) {
            throw new Error(`Physical file not found at path: ${row.file_path}`);
          }

          // Read file buffer
          const buffer = await fs.promises.readFile(row.file_path);

          // Extract text
          const extracted = await extractText(buffer, row.file_name);
          const rawText = (extracted.text || '').trim();

          if (!rawText) {
            throw new Error(`Failed to extract readable text from "${row.file_name}". File appears empty or corrupted.`);
          }

          // Duplicate detection rules (Task 6)
          if (row.file_type === 'candidate') {
            const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            const phoneMatch = rawText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+?\d{10,13}/);
            const email = emailMatch ? emailMatch[0].toLowerCase().trim() : null;
            const phone = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, '').trim() : null;

            if (email && phone) {
              const existingCandidate = await pool.query(
                `SELECT id FROM candidate1 WHERE LOWER(TRIM(candidate_email)) = $1 AND (phone = $2 OR phone LIKE $3) LIMIT 1;`,
                [email, phone, `%${phone.slice(-10)}%`]
              );

              if (existingCandidate.rows.length > 0) {
                throw new Error(`Duplicate candidate skipped: Candidate with email "${email}" and phone "${phone}" already exists in candidate1.`);
              }
            }
          } else if (row.file_type === 'job') {
            if (row.position_id) {
              const existingJob = await pool.query(
                `SELECT id FROM job_descriptions WHERE id = $1::bigint OR LOWER(TRIM(job_code)) = LOWER(TRIM($2)) LIMIT 1;`,
                [row.position_id, row.position_id]
              );
              if (existingJob.rows.length > 0) {
                throw new Error(`Duplicate job skipped: Job position ID "${row.position_id}" already exists in job_descriptions.`);
              }
            }
          }

          // Build payload with uploader's user_id and position_id
          const targetWebhookUrl =
            row.file_type === 'candidate'
              ? (process.env.N8N_CANDIDATE_RESUME_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_CANDIDATE_RESUME_WEBHOOK_URL || '')
              : (process.env.N8N_JD_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_JD_WEBHOOK_URL || '');

          const payload: any = {
            batch_id: row.batch_id,
            batchId: row.batch_id,
            user_id: row.user_id,
            userId: row.user_id,
            created_by: row.user_id,
            createdBy: row.user_id,
            position_id: row.position_id || null,
          };

          if (row.file_type === 'candidate') {
            payload.resumes = [
              {
                file_name: row.file_name,
                file_type: extracted.fileType || 'application/pdf',
                text: rawText,
              },
            ];
          } else {
            payload.job_descriptions = [
              {
                file_name: row.file_name,
                file_type: extracted.fileType || 'application/pdf',
                text: rawText,
                position_id: row.position_id || undefined,
              },
            ];
          }

          // Dispatch to n8n webhook
          if (targetWebhookUrl) {
            const webhookRes = await fetch(targetWebhookUrl.trim(), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': secret,
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(30000),
              redirect: 'manual',
            });

            if (!webhookRes.ok) {
              const errBody = await webhookRes.text().catch(() => '');
              throw new Error(`n8n webhook returned HTTP ${webhookRes.status}: ${errBody || 'Unknown workflow error'}`);
            }
          } else {
            console.warn(`[ProcessQueue] No webhook URL configured for type "${row.file_type}". Simulating successful parse.`);
          }

          // Mark row as done
          await pool.query(
            `UPDATE upload_queue
             SET status = 'done', processed_at = NOW(), error_message = NULL
             WHERE id = $1`,
            [row.id]
          );

          // Move file to processed directory
          await moveFile(row.file_path, 'processed');

          processedCount++;
        } catch (itemErr: any) {
          console.error(`[ProcessQueue] Error processing queue row ${row.id} (${row.file_name}):`, itemErr.message);

          // Mark row as failed with error details
          await pool.query(
            `UPDATE upload_queue
             SET status = 'failed', processed_at = NOW(), error_message = $1
             WHERE id = $2`,
            [itemErr.message || 'Unknown processing error', row.id]
          );

          // Move file to failed directory
          await moveFile(row.file_path, 'failed');

          failedCount++;
        }
      }

      // 6. After the loop, update upload_batches status for batches that have no remaining pending/processing rows
      for (const batchId of affectedBatchIds) {
        const remaining = await pool.query(
          `SELECT
             COUNT(CASE WHEN status IN ('pending', 'processing') THEN 1 END) as pending_count,
             COUNT(CASE WHEN status = 'done' THEN 1 END) as done_count,
             COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
             COUNT(*) as total_count
           FROM upload_queue
           WHERE batch_id = $1`,
          [batchId]
        );

        const counts = remaining.rows[0];
        const pending = Number(counts.pending_count || 0);
        const done = Number(counts.done_count || 0);
        const failed = Number(counts.failed_count || 0);

        if (pending === 0) {
          const finalStatus = failed === 0 ? 'completed' : done === 0 ? 'failed' : 'completed_with_errors';
          const msg = `${done} item(s) processed successfully, ${failed} item(s) failed.`;

          await updateBatchStatus(batchId, {
            status: finalStatus,
            inserted_count: done,
            failed_count: failed,
            message: msg,
          });
        }
      }

      return NextResponse.json({
        processed: processedCount,
        failed: failedCount,
        total_claimed: rows.length,
      });
    } finally {
      isQueueProcessing = false;
    }
  } catch (error: any) {
    isQueueProcessing = false;
    console.error('[ProcessQueue] Unexpected fatal error in queue worker:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

