export const runtime = 'nodejs';

import '@/utils/dns-fix';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/auth';
import { extractTextFromFile, isSupportedFormat, resolveFileType } from '@/utils/documentParser';
import crypto from 'crypto';
import { pool } from '@/database/db';
import { createBatch, processJobBatchAsync, updateBatchStatus } from '@/services/batchService';

interface JobDescriptionPayloadItem {
  position_id?: string | null;
  job_title?: string;
  description?: string;
  file_name: string;
  file_type: string;
  text?: string;
  wordCount?: number;
  charCount?: number;
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';
    const processedJDs: JobDescriptionPayloadItem[] = [];
    let customWebhookUrl: string | null = null;
    const isQueuedMode = (process.env.UPLOAD_MODE || 'realtime').toLowerCase() === 'queued';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      customWebhookUrl = (formData.get('webhook_url') as string) || (formData.get('webhookUrl') as string) || null;
      const positionId = (formData.get('position_id') || formData.get('positionId') || formData.get('job_code') || formData.get('jobCode')) as string | null;

      // Collect all files from 'files' or 'file' keys in FormData
      const uploadedFiles: File[] = [];
      const filesFromList = formData.getAll('files');
      const filesFromSingle = formData.getAll('file');

      for (const f of [...filesFromList, ...filesFromSingle]) {
        if (f && typeof f === 'object' && 'arrayBuffer' in f && (f as File).size > 0) {
          uploadedFiles.push(f as File);
        }
      }

      const directText = (formData.get('jdText') || formData.get('text')) as string | null;

      if (uploadedFiles.length === 0 && (!directText || directText.trim().length === 0)) {
        return NextResponse.json(
          { error: 'No job description files or text provided. Please select at least one file.' },
          { status: 400 }
        );
      }

      // -----------------------------------------------------------------------
      // QUEUED MODE: Extract text server-side, insert into job_queue table.
      // No files are written to disk.
      // -----------------------------------------------------------------------
      if (isQueuedMode) {
        for (const file of uploadedFiles) {
          if (!isSupportedFormat(file.name)) {
            return NextResponse.json(
              { error: `File "${file.name}" has an unsupported format. Supported formats: .pdf, .docx, .doc, .xlsx, .xls, .csv, .txt` },
              { status: 400 }
            );
          }
        }

        const batchId = `batch_job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
        const callbackUrl = `${appBaseUrl}/api/webhooks/n8n/batch-complete`;

        const queueRows: { fileName: string; fileType: string; text: string; positionId: string | null }[] = [];

        // Extract text from each uploaded file server-side
        for (const file of uploadedFiles) {
          const buffer = Buffer.from(await file.arrayBuffer());
          let extracted;
          try {
            extracted = await extractTextFromFile(buffer, file.name, file.type);
          } catch (err: any) {
            return NextResponse.json(
              { error: `Failed to extract text from "${file.name}": ${err.message}` },
              { status: 400 }
            );
          }

          const rawText = (extracted.text || '').trim();

          const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
          if (
            !rawText ||
            (isPdf &&
              (rawText.startsWith('%PDF-') ||
                /\b(?:xref|endobj|%%EOF)\b/.test(rawText) ||
                rawText.includes('%PDF-')))
          ) {
            return NextResponse.json(
              {
                error: isPdf
                  ? `PDF text extraction failed for "${file.name}".`
                  : `Failed to extract text from "${file.name}". The document appears empty or unreadable.`,
              },
              { status: 400 }
            );
          }

          queueRows.push({
            fileName: file.name,
            fileType: resolveFileType(file.name, file.type),
            text: rawText,
            positionId: positionId || null,
          });
        }

        // Handle pasted/direct text
        if (directText && directText.trim().length > 0) {
          const textVal = directText.trim();
          const directName = (formData.get('fileName') as string) || 'manual-job-description.txt';
          queueRows.push({
            fileName: directName,
            fileType: 'text/plain',
            text: textVal,
            positionId: positionId || null,
          });
        }

        if (queueRows.length === 0) {
          return NextResponse.json(
            { error: 'No valid job descriptions found to queue.' },
            { status: 400 }
          );
        }

        // Create upload_batches row
        await createBatch({
          id: batchId,
          userId: user.id,
          batchType: 'job',
          totalReceived: queueRows.length,
          metadata: {
            file_names: queueRows.map((r) => r.fileName),
            mode: 'queued',
          },
        });

        // Insert one row per JD into job_queue
        for (const row of queueRows) {
          await pool.query(
            `INSERT INTO job_queue
               (batch_id, user_id, file_name, file_type, job_text, position_id, callback_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'incoming')`,
            [batchId, user.id, row.fileName, row.fileType, row.text, row.positionId, callbackUrl]
          );
        }

        await updateBatchStatus(batchId, {
          status: 'queued',
          message: `${queueRows.length} job file(s) queued for background processing.`,
        });

        console.log(
          `[Job Description Upload] Batch "${batchId}" queued — ${queueRows.length} row(s) inserted into job_queue.`
        );

        return NextResponse.json(
          {
            batch_id: batchId,
            status: 'queued',
            total_received: queueRows.length,
            message: 'Job descriptions uploaded and queued for background processing.',
          },
          { status: 202 }
        );
      }

      // -----------------------------------------------------------------------
      // REALTIME MODE: Extract text and send directly to n8n (unchanged).
      // -----------------------------------------------------------------------
      for (const file of uploadedFiles) {
        if (!isSupportedFormat(file.name)) {
          return NextResponse.json(
            {
              error: `File "${file.name}" has an unsupported format. Supported formats: .pdf, .docx, .doc, .xlsx, .xls, .csv, .txt`,
            },
            { status: 400 }
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        let extracted;
        try {
          extracted = await extractTextFromFile(buffer, file.name, file.type);
        } catch (err: any) {
          if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
            return NextResponse.json(
              { error: 'PDF text extraction failed' },
              { status: 400 }
            );
          }
          throw err;
        }

        const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
        if (
          !extracted.text ||
          extracted.text.trim().length === 0 ||
          (isPdf &&
            (extracted.text.startsWith('%PDF-') ||
              /\b(?:xref|endobj|%%EOF)\b/.test(extracted.text) ||
              extracted.text.includes('%PDF-')))
        ) {
          return NextResponse.json(
            {
              error: isPdf
                ? 'PDF text extraction failed'
                : `Failed to extract text from file "${file.name}". The document appears to be empty or unreadable.`,
            },
            { status: 400 }
          );
        }

        processedJDs.push({
          file_name: file.name,
          file_type: resolveFileType(file.name, file.type),
          text: extracted.text,
          wordCount: extracted.wordCount,
          charCount: extracted.charCount,
        });
      }

      // If direct text was submitted alongside or instead
      if (directText && directText.trim().length > 0) {
        const textVal = directText.trim();
        processedJDs.push({
          file_name: (formData.get('fileName') as string) || 'manual-job-description.txt',
          file_type: 'text/plain',
          text: textVal,
          wordCount: textVal.split(/\s+/).filter(Boolean).length,
          charCount: textVal.length,
        });
      }
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      customWebhookUrl = body.webhook_url || body.webhookUrl || null;

      // JSON + queued mode: treat text fields directly (no base64/disk)
      if (isQueuedMode) {
        const batchId = `batch_job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
        const callbackUrl = `${appBaseUrl}/api/webhooks/n8n/batch-complete`;

        const queueRows: { fileName: string; fileType: string; text: string; positionId: string | null }[] = [];

        if (Array.isArray(body.job_descriptions) && body.job_descriptions.length > 0) {
          for (const item of body.job_descriptions) {
            const hasText = item.text && typeof item.text === 'string' && item.text.trim().length > 0;
            const hasDesc = item.description && typeof item.description === 'string' && item.description.trim().length > 0;
            if (!hasText && !hasDesc) {
              return NextResponse.json(
                { error: `Item "${item.file_name || 'unnamed'}" does not contain valid text or description.` },
                { status: 400 }
              );
            }
            const fileName = item.file_name || 'job_description.txt';
            queueRows.push({
              fileName,
              fileType: item.file_type || resolveFileType(fileName),
              text: (hasText ? item.text : item.description).trim(),
              positionId: item.position_id || null,
            });
          }
        } else if ((body.text || body.description) && typeof (body.text || body.description) === 'string') {
          const fileName = body.fileName || body.file_name || 'pasted-job-description.txt';
          queueRows.push({
            fileName,
            fileType: resolveFileType(fileName),
            text: (body.text || body.description).trim(),
            positionId: body.position_id || null,
          });
        }

        if (queueRows.length === 0) {
          return NextResponse.json(
            { error: 'Please provide at least one job description with valid content.' },
            { status: 400 }
          );
        }

        await createBatch({
          id: batchId,
          userId: user.id,
          batchType: 'job',
          totalReceived: queueRows.length,
          metadata: { file_names: queueRows.map((r) => r.fileName), mode: 'queued' },
        });

        for (const row of queueRows) {
          await pool.query(
            `INSERT INTO job_queue
               (batch_id, user_id, file_name, file_type, job_text, position_id, callback_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'incoming')`,
            [batchId, user.id, row.fileName, row.fileType, row.text, row.positionId, callbackUrl]
          );
        }

        await updateBatchStatus(batchId, {
          status: 'queued',
          message: `${queueRows.length} job file(s) queued for background processing.`,
        });

        return NextResponse.json(
          {
            batch_id: batchId,
            status: 'queued',
            total_received: queueRows.length,
            message: 'Job descriptions uploaded and queued for background processing.',
          },
          { status: 202 }
        );
      }

      if (Array.isArray(body.job_descriptions) && body.job_descriptions.length > 0) {
        for (const item of body.job_descriptions) {
          const hasText = item.text && typeof item.text === 'string' && item.text.trim().length > 0;
          const hasDesc = item.description && typeof item.description === 'string' && item.description.trim().length > 0;

          if (!hasText && !hasDesc) {
            return NextResponse.json(
              { error: `Item "${item.file_name || 'unnamed'}" does not contain valid text or description.` },
              { status: 400 }
            );
          }

          const textVal = hasText ? item.text.trim() : '';
          const descVal = hasDesc ? item.description.trim() : '';

          const fileName = item.file_name || 'job_description.txt';
          const fileType = item.file_type || resolveFileType(fileName);
          const isPdf = fileName.toLowerCase().endsWith('.pdf') || fileType === 'application/pdf';

          if (
            isPdf &&
            (textVal.startsWith('%PDF-') ||
              /\b(?:xref|endobj|%%EOF)\b/.test(textVal) ||
              textVal.includes('%PDF-'))
          ) {
            return NextResponse.json(
              { error: 'PDF text extraction failed' },
              { status: 400 }
            );
          }

          const fallbackWordCount = hasText ? textVal.split(/\s+/).filter(Boolean).length : descVal.split(/\s+/).filter(Boolean).length;
          const fallbackCharCount = hasText ? textVal.length : descVal.length;

          processedJDs.push({
            position_id: item.position_id,
            job_title: item.job_title,
            description: item.description,
            file_name: fileName,
            file_type: fileType,
            text: textVal || descVal || undefined,
            wordCount: fallbackWordCount,
            charCount: fallbackCharCount,
          });
        }
      } else if (body.text && typeof body.text === 'string' && body.text.trim().length > 0) {
        const textVal = body.text.trim();
        const fileName = body.fileName || body.file_name || 'pasted-job-description.txt';
        processedJDs.push({
          file_name: fileName,
          file_type: resolveFileType(fileName),
          text: textVal,
          wordCount: textVal.split(/\s+/).filter(Boolean).length,
          charCount: textVal.length,
        });
      } else {
        return NextResponse.json(
          { error: 'Please provide at least one job description with non-empty text.' },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Unsupported Content-Type. Use multipart/form-data or application/json.' },
        { status: 400 }
      );
    }

    if (processedJDs.length === 0) {
      return NextResponse.json(
        { error: 'No valid job descriptions found to process.' },
        { status: 400 }
      );
    }

    // Determine target webhook URL for Job Description (realtime mode)
    const customHeaderUrl = request.headers.get('x-webhook-url');
    const webhookUrl =
      (customWebhookUrl && customWebhookUrl.trim()) ||
      (customHeaderUrl && customHeaderUrl.trim()) ||
      process.env.N8N_JD_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_N8N_JD_WEBHOOK_URL ||
      '';

    const secret = process.env.N8N_SHARED_SECRET || '';

    // Generate unique batch ID
    const batchId = `batch_job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Register batch in Supabase upload_batches table
    await createBatch({
      id: batchId,
      userId: user.id,
      batchType: 'job',
      totalReceived: processedJDs.length,
      metadata: {
        file_names: processedJDs.map((j) => j.file_name),
      },
    });

    console.log(
      `[Job Description Upload] Registered batch "${batchId}" with ${processedJDs.length} item(s). Starting async n8n processing...`
    );

    // Trigger asynchronous background worker without waiting for long-running workflow
    setImmediate(() => {
      processJobBatchAsync(batchId, user.id, processedJDs as any, webhookUrl, secret).catch(
        (err) => {
          console.error(`[Job Description Upload] Background processing error for batch ${batchId}:`, err);
        }
      );
    });

    // Return accepted response with batch_id and processing status
    return NextResponse.json(
      {
        batch_id: batchId,
        status: 'processing',
        total_received: processedJDs.length,
        message: 'Files uploaded. Sending to n8n for processing...',
      },
      { status: 202 }
    );
  } catch (error: any) {
    console.error('Error processing job description file upload:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process and upload job description(s).' },
      { status: 500 }
    );
  }
}
