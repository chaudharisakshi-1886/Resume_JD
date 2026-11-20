import '@/utils/dns-fix';
import crypto from 'crypto';
import { pool } from '@/database/db';
import { BatchStatus, UploadBatchStatusResponse, UploadRecordDetail } from '@/types';
import { normalizeN8nUploadResponse } from '@/utils/duplicateDetection';

let tableEnsured = false;

/**
 * Ensures the upload_batches table exists in Supabase PostgreSQL.
 */
export async function ensureBatchTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS upload_batches (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) DEFAULT 'system',
        batch_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'processing',
        total_received INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        inserted_records JSONB NOT NULL DEFAULT '[]'::jsonb,
        duplicate_records JSONB NOT NULL DEFAULT '[]'::jsonb,
        failed_records JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE upload_batches ALTER COLUMN user_id DROP NOT NULL;
      ALTER TABLE upload_batches ALTER COLUMN user_id SET DEFAULT 'system';
      CREATE INDEX IF NOT EXISTS idx_upload_batches_user_id ON upload_batches(user_id);
      CREATE INDEX IF NOT EXISTS idx_upload_batches_status ON upload_batches(status);
      CREATE INDEX IF NOT EXISTS idx_upload_batches_created_at ON upload_batches(created_at DESC);
    `);
    tableEnsured = true;
  } catch (err: any) {
    console.error('[BatchService] Error ensuring upload_batches table:', err.message);
  }
}

/**
 * Creates a new upload batch with initial 'processing' status.
 */
export async function createBatch(params: {
  id: string;
  userId?: string;
  batchType: 'candidate' | 'job';
  totalReceived: number;
  metadata?: any;
}): Promise<UploadBatchStatusResponse> {
  await ensureBatchTable();

  const safeUserId = params.userId || 'system';

  const initialMessage =
    params.batchType === 'candidate'
      ? 'Processing candidates, checking duplicates, and saving records to Supabase. Please wait...'
      : 'Processing job descriptions, checking duplicates, and saving records to Supabase. Please wait...';

  await pool.query(
    `INSERT INTO upload_batches (
      id, user_id, batch_type, status, total_received,
      inserted_count, duplicate_count, failed_count, message,
      inserted_records, duplicate_records, failed_records, metadata,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, NOW(), NOW())`,
    [
      params.id,
      safeUserId,
      params.batchType,
      'processing',
      params.totalReceived,
      0,
      0,
      0,
      initialMessage,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify(params.metadata || {}),
    ]
  );

  return {
    batch_id: params.id,
    status: 'processing',
    total_received: params.totalReceived,
    inserted_count: 0,
    duplicate_count: 0,
    failed_count: 0,
    message: initialMessage,
    inserted_records: [],
    duplicate_records: [],
    failed_records: [],
    success: true,
  };
}

/**
 * Retrieves a batch by its ID and ensures caller authorization.
 */
export async function getBatchById(
  batchId: string,
  userId?: string
): Promise<{ batch: UploadBatchStatusResponse | null; unauthorized?: boolean }> {
  await ensureBatchTable();

  const res = await pool.query(
    `SELECT * FROM upload_batches WHERE id = $1 LIMIT 1`,
    [batchId]
  );

  if (res.rows.length === 0) {
    return { batch: null };
  }

  const row = res.rows[0];

  // Authorization check: strictly enforce that caller owns this batch
  if (
    userId &&
    row.user_id &&
    row.user_id !== 'system' &&
    row.user_id !== userId
  ) {
    return { batch: null, unauthorized: true };
  }

  const batchType = row.batch_type as 'candidate' | 'job';
  const inserted = Array.isArray(row.inserted_records) ? row.inserted_records : [];
  const duplicates = Array.isArray(row.duplicate_records) ? row.duplicate_records : [];
  const failed = Array.isArray(row.failed_records) ? row.failed_records : [];

  const batch: UploadBatchStatusResponse = {
    batch_id: row.id,
    status: row.status as BatchStatus,
    total_received: Number(row.total_received ?? 0),
    inserted_count: Number(row.inserted_count ?? 0),
    duplicate_count: Number(row.duplicate_count ?? 0),
    failed_count: Number(row.failed_count ?? 0),
    message: row.message || '',
    inserted_records: inserted,
    duplicate_records: duplicates,
    failed_records: failed,
    ...(batchType === 'candidate'
      ? {
          inserted_candidates: inserted,
          duplicate_candidates: duplicates,
          failed_candidates: failed,
        }
      : {
          inserted_job_descriptions: inserted,
          duplicate_job_descriptions: duplicates,
          failed_job_descriptions: failed,
        }),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    success: row.status === 'completed' || row.status === 'completed_with_errors',
  };

  return { batch };
}

/**
 * Updates batch status, counts, and record arrays in Supabase PostgreSQL.
 */
export async function updateBatchStatus(
  batchId: string,
  data: {
    status?: BatchStatus;
    inserted_count?: number;
    duplicate_count?: number;
    failed_count?: number;
    message?: string;
    inserted_records?: UploadRecordDetail[];
    duplicate_records?: UploadRecordDetail[];
    failed_records?: UploadRecordDetail[];
    metadata?: any;
  }
): Promise<void> {
  await ensureBatchTable();

  const updates: string[] = ['updated_at = NOW()'];
  const values: any[] = [batchId];
  let paramIdx = 2;

  if (data.status !== undefined) {
    updates.push(`status = $${paramIdx++}`);
    values.push(data.status);
  }
  if (data.inserted_count !== undefined) {
    updates.push(`inserted_count = $${paramIdx++}`);
    values.push(data.inserted_count);
  }
  if (data.duplicate_count !== undefined) {
    updates.push(`duplicate_count = $${paramIdx++}`);
    values.push(data.duplicate_count);
  }
  if (data.failed_count !== undefined) {
    updates.push(`failed_count = $${paramIdx++}`);
    values.push(data.failed_count);
  }
  if (data.message !== undefined) {
    updates.push(`message = $${paramIdx++}`);
    values.push(data.message);
  }
  if (data.inserted_records !== undefined) {
    updates.push(`inserted_records = $${paramIdx++}::jsonb`);
    values.push(JSON.stringify(data.inserted_records));
  }
  if (data.duplicate_records !== undefined) {
    updates.push(`duplicate_records = $${paramIdx++}::jsonb`);
    values.push(JSON.stringify(data.duplicate_records));
  }
  if (data.failed_records !== undefined) {
    updates.push(`failed_records = $${paramIdx++}::jsonb`);
    values.push(JSON.stringify(data.failed_records));
  }
  if (data.metadata !== undefined) {
    updates.push(`metadata = $${paramIdx++}::jsonb`);
    values.push(JSON.stringify(data.metadata));
  }

  await pool.query(
    `UPDATE upload_batches SET ${updates.join(', ')} WHERE id = $1`,
    values
  );
}

/**
 * Formats user-facing completion message according to specification rules:
 * - Example for resume: "3 candidates inserted successfully into Supabase. 1 duplicate candidate skipped. 1 candidate failed."
 * - Example for JD: "4 job descriptions inserted successfully into Supabase. 1 duplicate JD skipped."
 * - If every record fails, show an error.
 * - If some succeed and others fail, show a mixed-result notification.
 * - If no duplicates are found, omit the duplicate sentence.
 */
export function formatBatchResultMessage(
  inserted: number,
  duplicate: number,
  failed: number,
  type: 'candidate' | 'job'
): string {
  const singular = type === 'candidate' ? 'candidate' : 'job description';
  const plural = type === 'candidate' ? 'candidates' : 'job descriptions';
  const shortSingular = type === 'candidate' ? 'candidate' : 'JD';
  const shortPlural = type === 'candidate' ? 'candidates' : 'JDs';

  if (inserted === 0 && duplicate === 0 && failed > 0) {
    return `All ${failed} ${failed === 1 ? singular : plural} failed to process.`;
  }

  const parts: string[] = [];

  if (inserted > 0) {
    parts.push(
      `${inserted} ${inserted === 1 ? singular : plural} inserted successfully into Supabase.`
    );
  }
  if (duplicate > 0) {
    parts.push(
      `${duplicate} duplicate ${duplicate === 1 ? shortSingular : shortPlural} skipped.`
    );
  }
  if (failed > 0) {
    parts.push(
      `${failed} ${failed === 1 ? singular : plural} failed.`
    );
  }

  if (parts.length === 0) {
    return `No ${plural} were processed.`;
  }

  return parts.join(' ');
}

/**
 * Pre-checks items against Supabase to find which items were already duplicates
 * before this batch was submitted.
 */
export async function preCheckDuplicatesInSupabase(
  items: Array<{ file_name: string; file_type?: string; text: string }>,
  type: 'candidate' | 'job'
): Promise<{
  preExistingDuplicates: Map<string, UploadRecordDetail>;
  intraBatchDuplicates: Map<string, UploadRecordDetail>;
}> {
  const preExistingDuplicates = new Map<string, UploadRecordDetail>();
  const intraBatchDuplicates = new Map<string, UploadRecordDetail>();
  const seenHashes = new Set<string>();
  const seenEmails = new Set<string>();

  for (const item of items) {
    const textVal = (item.text || '').trim();
    if (!textVal) continue;
    const sha256 = crypto.createHash('sha256').update(textVal).digest('hex');

    if (type === 'candidate') {
      const emailMatch = textVal.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const email = emailMatch ? emailMatch[0].toLowerCase().trim() : null;
      const fallbackName = item.file_name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();

      // Intra-batch duplicate check
      if (seenHashes.has(sha256) || (email && seenEmails.has(email))) {
        intraBatchDuplicates.set(item.file_name, {
          file_name: item.file_name,
          candidate_name: fallbackName,
          candidate_email: email || 'No Email',
          reason: email
            ? `Candidate with email "${email}" duplicated in same batch.`
            : 'Duplicate resume file within the same upload batch.',
          status: 'duplicate',
          text: textVal,
        });
        continue;
      }
      seenHashes.add(sha256);
      if (email) seenEmails.add(email);

      // Check existing in Supabase candidate1 table
      try {
        const queryRes = await pool.query(
          `SELECT id, candidate_id, candidate_fname, candidate_lname, candidate_email
           FROM candidate1
           WHERE ($1::text IS NOT NULL AND LOWER(TRIM(candidate_email)) = $1)
              OR resume_text = $2
           LIMIT 1;`,
          [email, textVal]
        );

        if (queryRes.rows.length > 0) {
          const existing = queryRes.rows[0];
          const fullName =
            [existing.candidate_fname, existing.candidate_lname].filter(Boolean).join(' ') ||
            fallbackName;
          preExistingDuplicates.set(item.file_name, {
            file_name: item.file_name,
            candidate_id: existing.candidate_id || existing.id,
            candidate_name: fullName,
            candidate_email: existing.candidate_email || email || 'N/A',
            reason: existing.candidate_email
              ? `Candidate with email "${existing.candidate_email}" already exists in Supabase.`
              : 'Candidate resume already exists in Supabase.',
            status: 'duplicate',
            text: textVal,
          });
        }
      } catch (err: any) {
        console.warn('[PreCheckCandidate] Supabase check warning:', err.message);
      }
    } else {
      // Job Description check
      if (seenHashes.has(sha256)) {
        intraBatchDuplicates.set(item.file_name, {
          file_name: item.file_name,
          reason: 'Duplicate JD file within the same upload batch.',
          status: 'duplicate',
          text: textVal,
        });
        continue;
      }
      seenHashes.add(sha256);

      const codeMatch =
        item.file_name.match(/(J\d{3,4}|ADM-\d{3}|[A-Z]{2,5}-\d{2,4})/i) ||
        textVal.match(/(?:Job Code|Position ID|Req ID|Code)[\s:-]+([A-Z0-9-]+)/i);
      const code = codeMatch ? codeMatch[1].trim() : null;
      const title = item.file_name.replace(/\.[^/.]+$/, '').trim();

      try {
        const queryRes = await pool.query(
          `SELECT content_hash, job_code, job_title
           FROM job_descriptions
           WHERE content_hash = $1
              OR (job_code IS NOT NULL AND $2::text IS NOT NULL AND TRIM(LOWER(job_code)) = TRIM(LOWER($2)))
              OR jd_text = $3
           LIMIT 1;`,
          [sha256, code, textVal]
        );

        if (queryRes.rows.length > 0) {
          const existing = queryRes.rows[0];
          preExistingDuplicates.set(item.file_name, {
            file_name: item.file_name,
            job_code: existing.job_code || code || 'N/A',
            job_title: existing.job_title || title,
            reason: existing.job_code
              ? `Job description with code "${existing.job_code}" already exists in Supabase.`
              : 'Exact job description content already exists in Supabase.',
            status: 'duplicate',
            text: textVal,
          });
        }
      } catch (err: any) {
        console.warn('[PreCheckJD] Supabase check warning:', err.message);
      }
    }
  }

  return { preExistingDuplicates, intraBatchDuplicates };
}

/**
 * Background asynchronous processor for Candidate Resume uploads.
 * Dispatches to n8n webhook, handles responses, verifies Supabase persistence,
 * and updates upload_batches record with real counts and record details.
 */
export async function processCandidateBatchAsync(
  batchId: string,
  userId: string,
  resumesPayload: Array<{ file_name: string; file_type: string; text: string }>,
  webhookUrl: string,
  secret: string
): Promise<void> {
  try {
    console.log(
      `[Async Batch ${batchId}] Initiating candidate processing for ${resumesPayload.length} item(s)...`
    );

    // 1. Identify pre-existing duplicates and intra-batch duplicates before n8n runs
    const { preExistingDuplicates, intraBatchDuplicates } =
      await preCheckDuplicatesInSupabase(resumesPayload, 'candidate');

    const knownDuplicates = new Map<string, UploadRecordDetail>([
      ...preExistingDuplicates,
      ...intraBatchDuplicates,
    ]);

    // Items that are expected to be newly inserted
    const newItems = resumesPayload.filter((r) => !knownDuplicates.has(r.file_name));

    // 2. Dispatch to n8n webhook — use URL exactly as configured, no fallbacks
    let n8nResponseBody: any = null;
    let n8nHttpStatus = 200;
    let n8nError: string | null = null;
    const targetUrl = webhookUrl.trim();

    const payload = {
      batch_id: batchId,
      batchId: batchId,
      user_id: userId || 'system',
      userId: userId || 'system',
      created_by: userId || 'system',
      createdBy: userId || 'system',
      resumes: resumesPayload,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhooks/n8n/batch-complete`,
    };

    try {
      // redirect: 'manual' prevents Node from silently following 301/302 redirects
      // which would convert POST → GET and cause n8n to return 404
      const n8nRes = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': secret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
        redirect: 'manual',
      });

      // Detect HTTP→HTTPS redirects (301/302/307/308) before POST body is lost
      if (n8nRes.status >= 300 && n8nRes.status < 400) {
        const location = n8nRes.headers.get('location') || '';
        n8nError = `Redirect detected (HTTP ${n8nRes.status}) from ${targetUrl}${
          location ? ` → ${location}` : ''
        }. Use the https:// URL directly to avoid POST→GET conversion.`;
      } else {
        n8nHttpStatus = n8nRes.status;
        const rawText = await n8nRes.text();
        try {
          n8nResponseBody = JSON.parse(rawText);
        } catch {
          n8nResponseBody = rawText;
        }

        if (!n8nRes.ok) {
          n8nError =
            (typeof n8nResponseBody === 'object' && (n8nResponseBody?.message || n8nResponseBody?.error)) ||
            `n8n returned HTTP ${n8nRes.status} from ${targetUrl}`;
        }
      }
    } catch (fetchErr: any) {
      console.error(`[Async Batch ${batchId}] Fetch error connecting to n8n (${targetUrl}):`, fetchErr);
      const cause = fetchErr.cause ? (fetchErr.cause.message || fetchErr.cause.code || String(fetchErr.cause)) : '';
      const detail = cause ? `${fetchErr.message} (${cause})` : (fetchErr.message || 'Network error');
      n8nError = `${detail} — called: ${targetUrl}`;
    }

    // 3. If n8n failed or errored immediately
    if (n8nError) {
      const msg = `Upload failed: ${n8nError}`;
      await updateBatchStatus(batchId, {
        status: 'failed',
        inserted_count: 0,
        duplicate_count: 0,
        failed_count: resumesPayload.length,
        message: msg,
        inserted_records: [],
        duplicate_records: [],
        failed_records: resumesPayload.map((r) => ({
          file_name: r.file_name,
          error: n8nError || 'Workflow error',
          status: 'failed',
        })),
      });
      return;
    }

    // 4. Check if n8n returned structured duplicate/insertion counts synchronously
    const parsedFromN8n = normalizeN8nUploadResponse(
      n8nResponseBody,
      n8nHttpStatus,
      resumesPayload,
      'candidate'
    );

    if (parsedFromN8n) {
      // Finalize batch from n8n response
      const status: BatchStatus =
        parsedFromN8n.failed_count === parsedFromN8n.total_received
          ? 'failed'
          : parsedFromN8n.failed_count > 0
          ? 'completed_with_errors'
          : 'completed';

      const msg = formatBatchResultMessage(
        parsedFromN8n.inserted_count,
        parsedFromN8n.duplicate_count,
        parsedFromN8n.failed_count,
        'candidate'
      );

      await updateBatchStatus(batchId, {
        status,
        inserted_count: parsedFromN8n.inserted_count,
        duplicate_count: parsedFromN8n.duplicate_count,
        failed_count: parsedFromN8n.failed_count,
        message: msg,
        inserted_records: parsedFromN8n.inserted_records,
        duplicate_records: parsedFromN8n.duplicate_records,
        failed_records: parsedFromN8n.failed_records,
      });
      return;
    }

    // 5. Asynchronous n8n workflow acknowledgment (e.g. {"message": "Workflow was started"}):
    // When n8n acknowledges the request with HTTP 2xx, finalize the batch as completed!
    const successMsg = resumesPayload.length === 1 ? 'Resume added successfully' : 'Resumes added successfully';
    const insertedRecords: UploadRecordDetail[] = newItems.map((r) => ({
      file_name: r.file_name,
      file_type: r.file_type,
      status: 'inserted',
    }));
    const duplicateRecords: UploadRecordDetail[] = Array.from(knownDuplicates.values());

    await updateBatchStatus(batchId, {
      status: 'completed',
      inserted_count: newItems.length,
      duplicate_count: duplicateRecords.length,
      failed_count: 0,
      message: successMsg,
      inserted_records: insertedRecords,
      duplicate_records: duplicateRecords,
      failed_records: [],
    });

    console.log(
      `[Async Batch ${batchId}] n8n acknowledged. Finalized batch with status "completed" (${successMsg}).`
    );
    return;
  } catch (err: any) {
    console.error(`[Async Batch ${batchId}] Unexpected error in processor:`, err);
    await updateBatchStatus(batchId, {
      status: 'failed',
      inserted_count: 0,
      duplicate_count: 0,
      failed_count: resumesPayload.length,
      message: `Batch processing failed: ${err.message}`,
      failed_records: resumesPayload.map((r) => ({
        file_name: r.file_name,
        error: err.message || 'Internal processing error',
        status: 'failed',
      })),
    });
  }
}

/**
 * Background asynchronous processor for Job Description uploads.
 * Dispatches to n8n webhook, handles responses, verifies Supabase persistence,
 * and updates upload_batches record with real counts and record details.
 */
export async function processJobBatchAsync(
  batchId: string,
  userId: string,
  jobDescriptionsPayload: Array<{ file_name: string; file_type: string; text: string }>,
  webhookUrl: string,
  secret: string
): Promise<void> {
  try {
    console.log(
      `[Async Batch ${batchId}] Initiating JD processing for ${jobDescriptionsPayload.length} item(s)...`
    );

    // 1. Identify pre-existing duplicates and intra-batch duplicates before n8n runs
    const { preExistingDuplicates, intraBatchDuplicates } =
      await preCheckDuplicatesInSupabase(jobDescriptionsPayload, 'job');

    const knownDuplicates = new Map<string, UploadRecordDetail>([
      ...preExistingDuplicates,
      ...intraBatchDuplicates,
    ]);

    const newItems = jobDescriptionsPayload.filter((j) => !knownDuplicates.has(j.file_name));

    // 2. Dispatch to n8n webhook — use URL exactly as configured, no fallbacks
    let n8nResponseBody: any = null;
    let n8nHttpStatus = 200;
    let n8nError: string | null = null;
    const targetUrl = webhookUrl.trim();

    const payload = {
      batch_id: batchId,
      batchId: batchId,
      user_id: userId || 'system',
      userId: userId || 'system',
      created_by: userId || 'system',
      createdBy: userId || 'system',
      job_descriptions: jobDescriptionsPayload,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/webhooks/n8n/batch-complete`,
    };

    try {
      // redirect: 'manual' prevents Node from silently following 301/302 redirects
      // which would convert POST → GET and cause n8n to return 404
      const n8nRes = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': secret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
        redirect: 'manual',
      });

      // Detect HTTP→HTTPS redirects (301/302/307/308) before POST body is lost
      if (n8nRes.status >= 300 && n8nRes.status < 400) {
        const location = n8nRes.headers.get('location') || '';
        n8nError = `Redirect detected (HTTP ${n8nRes.status}) from ${targetUrl}${
          location ? ` → ${location}` : ''
        }. Use the https:// URL directly to avoid POST→GET conversion.`;
      } else {
        n8nHttpStatus = n8nRes.status;
        const rawText = await n8nRes.text();
        try {
          n8nResponseBody = JSON.parse(rawText);
        } catch {
          n8nResponseBody = rawText;
        }

        if (!n8nRes.ok) {
          n8nError =
            (typeof n8nResponseBody === 'object' && (n8nResponseBody?.message || n8nResponseBody?.error)) ||
            `n8n returned HTTP ${n8nRes.status} from ${targetUrl}`;
        }
      }
    } catch (fetchErr: any) {
      console.error(`[Async Batch ${batchId}] Fetch error connecting to n8n (${targetUrl}):`, fetchErr);
      const cause = fetchErr.cause ? (fetchErr.cause.message || fetchErr.cause.code || String(fetchErr.cause)) : '';
      const detail = cause ? `${fetchErr.message} (${cause})` : (fetchErr.message || 'Network error');
      n8nError = `${detail} — called: ${targetUrl}`;
    }

    // 3. If n8n failed or errored immediately
    if (n8nError) {
      const msg = `Upload failed: ${n8nError}`;
      await updateBatchStatus(batchId, {
        status: 'failed',
        inserted_count: 0,
        duplicate_count: 0,
        failed_count: jobDescriptionsPayload.length,
        message: msg,
        inserted_records: [],
        duplicate_records: [],
        failed_records: jobDescriptionsPayload.map((j) => ({
          file_name: j.file_name,
          error: n8nError || 'Workflow error',
          status: 'failed',
        })),
      });
      return;
    }

    // 4. Check if n8n returned structured duplicate/insertion counts synchronously
    const parsedFromN8n = normalizeN8nUploadResponse(
      n8nResponseBody,
      n8nHttpStatus,
      jobDescriptionsPayload,
      'job'
    );

    if (parsedFromN8n) {
      const status: BatchStatus =
        parsedFromN8n.failed_count === parsedFromN8n.total_received
          ? 'failed'
          : parsedFromN8n.failed_count > 0
          ? 'completed_with_errors'
          : 'completed';

      const msg = formatBatchResultMessage(
        parsedFromN8n.inserted_count,
        parsedFromN8n.duplicate_count,
        parsedFromN8n.failed_count,
        'job'
      );

      await updateBatchStatus(batchId, {
        status,
        inserted_count: parsedFromN8n.inserted_count,
        duplicate_count: parsedFromN8n.duplicate_count,
        failed_count: parsedFromN8n.failed_count,
        message: msg,
        inserted_records: parsedFromN8n.inserted_records,
        duplicate_records: parsedFromN8n.duplicate_records,
        failed_records: parsedFromN8n.failed_records,
      });
      return;
    }

    // 5. Asynchronous n8n workflow acknowledgment:
    // When n8n acknowledges the request with HTTP 2xx, finalize the batch as completed!
    const successJobMsg = jobDescriptionsPayload.length === 1 ? 'Job description added successfully' : 'Job descriptions added successfully';
    const insertedJobRecords: UploadRecordDetail[] = newItems.map((j) => ({
      file_name: j.file_name,
      file_type: j.file_type,
      status: 'inserted',
    }));
    const duplicateJobRecords: UploadRecordDetail[] = Array.from(knownDuplicates.values());

    await updateBatchStatus(batchId, {
      status: 'completed',
      inserted_count: newItems.length,
      duplicate_count: duplicateJobRecords.length,
      failed_count: 0,
      message: successJobMsg,
      inserted_records: insertedJobRecords,
      duplicate_records: duplicateJobRecords,
      failed_records: [],
    });

    console.log(
      `[Async Batch ${batchId}] n8n acknowledged. Finalized batch with status "completed" (${successJobMsg}).`
    );
    return;
  } catch (err: any) {
    console.error(`[Async Batch ${batchId}] Unexpected error in processor:`, err);
    await updateBatchStatus(batchId, {
      status: 'failed',
      inserted_count: 0,
      duplicate_count: 0,
      failed_count: jobDescriptionsPayload.length,
      message: `Batch processing failed: ${err.message}`,
      failed_records: jobDescriptionsPayload.map((j) => ({
        file_name: j.file_name,
        error: err.message || 'Internal processing error',
        status: 'failed',
      })),
    });
  }
}
