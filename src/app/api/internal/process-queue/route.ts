export const runtime = 'nodejs';

import '@/utils/dns-fix';
import { NextResponse } from 'next/server';
import { pool } from '@/database/db';
import { updateBatchStatus } from '@/services/batchService';

// In-process lock to prevent overlapping runs within the same instance
let isQueueProcessing = false;

// ---------------------------------------------------------------------------
// POST /api/internal/process-queue
// Protected by x-secret header matching CRON_SECRET.
// Jobs: scans incoming/jobs folder (unchanged).
// Resumes: reads from resume_queue DB table (status = 'incoming').
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

    // Track resume metrics
    let resumesFound = 0;
    let resumesProcessed = 0;
    let resumesFailed = 0;

    try {
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
      //    — DB-table based: reads from job_queue WHERE status='incoming' —
      // =====================================================================
      const incomingJobsResult = await pool.query<{
        id: number;
        batch_id: string;
        user_id: string;
        file_name: string;
        file_type: string;
        job_text: string;
        position_id: string | null;
        callback_url: string;
      }>(
        `SELECT id, batch_id, user_id, file_name, file_type, job_text, position_id, callback_url
           FROM job_queue
          WHERE status = 'incoming'
          ORDER BY created_at`
      );

      const jobRows = incomingJobsResult.rows;
      jobsFound = jobRows.length;

      if (jobRows.length > 0) {
        // Atomically claim all fetched rows as 'processing'
        const jobIds = jobRows.map((r) => r.id);
        await pool.query(
          `UPDATE job_queue SET status = 'processing', updated_at = NOW() WHERE id = ANY($1)`,
          [jobIds]
        );

        for (const row of jobRows) {
          try {
            // Update upload_batches to 'processing' if the batch record exists
            try {
              const batchCheck = await pool.query(
                `SELECT id FROM upload_batches WHERE id = $1 LIMIT 1`,
                [row.batch_id]
              );
              if (batchCheck.rows.length > 0) {
                await updateBatchStatus(row.batch_id, {
                  status: 'processing',
                  message: `Processing job file "${row.file_name}"…`,
                });
              }
            } catch (batchErr: any) {
              console.warn(`[ProcessQueue] Could not update batch "${row.batch_id}": ${batchErr.message}`);
            }

            // Extract position_id from stored text if not explicitly set
            const rawText = row.job_text;
            let positionId = row.position_id || null;
            if (!positionId) {
              const codeMatch =
                row.file_name.match(/(J\d{3,4}|ADM-\d{3}|[A-Z]{2,5}-\d{2,4})/i) ||
                rawText.match(/(?:Job Code|Position ID|Req ID|Code)[\s:-]+([A-Z0-9-]+)/i);
              positionId = codeMatch ? codeMatch[1].trim() : null;
            }

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

            // Build exact realtime job description payload shape
            const payload = {
              batch_id: row.batch_id,
              batchId: row.batch_id,
              user_id: row.user_id,
              userId: row.user_id,
              created_by: row.user_id,
              createdBy: row.user_id,
              job_descriptions: [
                {
                  position_id: positionId,
                  file_name: row.file_name,
                  file_type: row.file_type,
                  text: rawText,
                  wordCount: rawText.split(/\s+/).filter(Boolean).length,
                  charCount: rawText.length,
                },
              ],
              callback_url: row.callback_url,
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
              console.warn(`[ProcessQueue] N8N_JD_WEBHOOK_URL not set. Skipping "${row.file_name}".`);
            }

            // Success — mark row as done
            await pool.query(
              `UPDATE job_queue SET status = 'done', updated_at = NOW() WHERE id = $1`,
              [row.id]
            );
            jobsProcessed++;
            console.log(`[ProcessQueue] ✔ Sent job "${row.file_name}" (queue id ${row.id}) to n8n.`);
          } catch (itemErr: any) {
            console.error(`[ProcessQueue] ✗ Error processing job queue id ${row.id} ("${row.file_name}"):`, itemErr.message);

            await pool.query(
              `UPDATE job_queue SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
              [itemErr.message.slice(0, 1000), row.id]
            ).catch((e) => console.error(`[ProcessQueue] Could not mark job row ${row.id} as failed:`, e.message));

            jobsFailed++;
          }
        }
      }

      // =====================================================================
      // 4. Process CANDIDATE RESUMES from resume_queue DB table
      //    status = 'incoming' → claim as 'processing' → send to n8n →
      //    mark 'done' or 'failed'. Do NOT set upload_batches to 'completed'
      //    — that is left to n8n's batch-complete callback.
      // =====================================================================
      const incomingResult = await pool.query<{
        id: number;
        batch_id: string;
        user_id: string;
        file_name: string;
        file_type: string;
        resume_text: string;
        callback_url: string;
      }>(
        `SELECT id, batch_id, user_id, file_name, file_type, resume_text, callback_url
           FROM resume_queue
          WHERE status = 'incoming'
          ORDER BY created_at`
      );

      const rows = incomingResult.rows;
      resumesFound = rows.length;

      if (rows.length > 0) {
        // Atomically claim all fetched rows as 'processing'
        const ids = rows.map((r) => r.id);
        await pool.query(
          `UPDATE resume_queue
              SET status = 'processing', updated_at = NOW()
            WHERE id = ANY($1)`,
          [ids]
        );

        for (const row of rows) {
          try {
            // Update upload_batches to 'processing' if the batch record exists
            try {
              const batchCheck = await pool.query(
                `SELECT id FROM upload_batches WHERE id = $1 LIMIT 1`,
                [row.batch_id]
              );
              if (batchCheck.rows.length > 0) {
                await updateBatchStatus(row.batch_id, {
                  status: 'processing',
                  message: `Processing file "${row.file_name}"…`,
                });
              }
            } catch (batchErr: any) {
              console.warn(`[ProcessQueue] Could not update batch "${row.batch_id}": ${batchErr.message}`);
            }

            // Build candidate resume payload (same structure as realtime mode)
            const payload = {
              batch_id: row.batch_id,
              batchId: row.batch_id,
              user_id: row.user_id,
              userId: row.user_id,
              created_by: row.user_id,
              createdBy: row.user_id,
              resumes: [
                {
                  file_name: row.file_name,
                  file_type: row.file_type,
                  text: row.resume_text,
                },
              ],
              callback_url: row.callback_url,
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
              console.warn(`[ProcessQueue] N8N_CANDIDATE_RESUME_WEBHOOK_URL not set. Skipping "${row.file_name}".`);
            }

            // Success — mark row as done
            await pool.query(
              `UPDATE resume_queue SET status = 'done', updated_at = NOW() WHERE id = $1`,
              [row.id]
            );
            resumesProcessed++;
            console.log(`[ProcessQueue] ✔ Sent resume "${row.file_name}" (queue id ${row.id}) to n8n.`);
          } catch (itemErr: any) {
            console.error(`[ProcessQueue] ✗ Error processing resume queue id ${row.id} ("${row.file_name}"):`, itemErr.message);

            // Mark row as failed with error message
            await pool.query(
              `UPDATE resume_queue
                  SET status = 'failed', error_message = $1, updated_at = NOW()
                WHERE id = $2`,
              [itemErr.message.slice(0, 1000), row.id]
            ).catch((e) => console.error(`[ProcessQueue] Could not mark row ${row.id} as failed:`, e.message));

            resumesFailed++;
          }
        }
      }

      return NextResponse.json({
        jobs: {
          found: jobsFound,
          processed: jobsProcessed,
          failed: jobsFailed,
        },
        resumes: {
          found: resumesFound,
          processed: resumesProcessed,
          failed: resumesFailed,
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
