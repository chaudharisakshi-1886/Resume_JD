export const runtime = 'nodejs';

import '@/utils/dns-fix';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/auth';
import { extractTextFromFile, isSupportedFormat, resolveFileType } from '@/utils/documentParser';
import crypto from 'crypto';
import { pool } from '@/database/db';
import { createBatch, processCandidateBatchAsync, updateBatchStatus } from '@/services/batchService';

interface ResumePayloadItem {
  file_name: string;
  file_type: string;
  text: string;
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
    const processedResumes: ResumePayloadItem[] = [];
    let customWebhookUrl: string | null = null;
    const isQueuedMode = (process.env.UPLOAD_MODE || 'realtime').toLowerCase() === 'queued';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();

      // Collect all files from 'files' or 'file' keys in FormData
      const uploadedFiles: File[] = [];
      const filesFromList = formData.getAll('files');
      const filesFromSingle = formData.getAll('file');

      for (const f of [...filesFromList, ...filesFromSingle]) {
        if (f && typeof f === 'object' && 'arrayBuffer' in f) {
          uploadedFiles.push(f as File);
        }
      }

      const directText = formData.get('resumeText') as string | null;

      if (uploadedFiles.length === 0 && (!directText || directText.trim().length === 0)) {
        return NextResponse.json(
          { error: 'No resume files or text provided. Please select at least one file.' },
          { status: 400 }
        );
      }

      // -----------------------------------------------------------------------
      // QUEUED MODE: Extract text server-side, insert into resume_queue table.
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

        const batchId = `batch_cand_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
        const callbackUrl = `${appBaseUrl}/api/webhooks/n8n/batch-complete`;

        // Items to insert into resume_queue
        const queueRows: { fileName: string; fileType: string; text: string }[] = [];

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
          });
        }

        // Handle pasted/direct text
        if (directText && directText.trim().length > 0) {
          const textVal = directText.trim();
          const directName = (formData.get('fileName') as string) || 'manual-resume.txt';
          queueRows.push({
            fileName: directName,
            fileType: 'text/plain',
            text: textVal,
          });
        }

        if (queueRows.length === 0) {
          return NextResponse.json(
            { error: 'No valid resumes found to queue.' },
            { status: 400 }
          );
        }

        // Create upload_batches row (status will be set to 'queued' below)
        await createBatch({
          id: batchId,
          userId: user.id,
          batchType: 'candidate',
          totalReceived: queueRows.length,
          metadata: {
            file_names: queueRows.map((r) => r.fileName),
            mode: 'queued',
          },
        });

        // Insert one row per resume into resume_queue
        for (const row of queueRows) {
          await pool.query(
            `INSERT INTO resume_queue
               (batch_id, user_id, file_name, file_type, resume_text, callback_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'incoming')`,
            [batchId, user.id, row.fileName, row.fileType, row.text, callbackUrl]
          );
        }

        await updateBatchStatus(batchId, {
          status: 'queued',
          message: `${queueRows.length} file(s) queued for background processing.`,
        });

        console.log(
          `[Candidate Upload] Batch "${batchId}" queued — ${queueRows.length} row(s) inserted into resume_queue.`
        );

        return NextResponse.json(
          {
            batch_id: batchId,
            status: 'queued',
            total_received: queueRows.length,
            message: 'Files uploaded and queued for background processing.',
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

        processedResumes.push({
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
        processedResumes.push({
          file_name: (formData.get('fileName') as string) || 'manual-resume.txt',
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
        const batchId = `batch_cand_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
        const callbackUrl = `${appBaseUrl}/api/webhooks/n8n/batch-complete`;

        const queueRows: { fileName: string; fileType: string; text: string }[] = [];

        if (Array.isArray(body.resumes) && body.resumes.length > 0) {
          for (const item of body.resumes) {
            const textVal = (item.text || '').trim();
            if (!textVal) {
              return NextResponse.json(
                { error: `Item "${item.file_name || 'unnamed'}" does not contain valid text.` },
                { status: 400 }
              );
            }
            const fileName = item.file_name || 'resume.txt';
            queueRows.push({
              fileName,
              fileType: item.file_type || resolveFileType(fileName),
              text: textVal,
            });
          }
        } else if (body.text && typeof body.text === 'string' && body.text.trim().length > 0) {
          const fileName = body.fileName || body.file_name || 'pasted-resume.txt';
          queueRows.push({
            fileName,
            fileType: resolveFileType(fileName),
            text: body.text.trim(),
          });
        }

        if (queueRows.length === 0) {
          return NextResponse.json(
            { error: 'Please provide at least one resume with non-empty content.' },
            { status: 400 }
          );
        }

        await createBatch({
          id: batchId,
          userId: user.id,
          batchType: 'candidate',
          totalReceived: queueRows.length,
          metadata: { file_names: queueRows.map((r) => r.fileName), mode: 'queued' },
        });

        for (const row of queueRows) {
          await pool.query(
            `INSERT INTO resume_queue
               (batch_id, user_id, file_name, file_type, resume_text, callback_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'incoming')`,
            [batchId, user.id, row.fileName, row.fileType, row.text, callbackUrl]
          );
        }

        await updateBatchStatus(batchId, {
          status: 'queued',
          message: `${queueRows.length} file(s) queued for background processing.`,
        });

        return NextResponse.json(
          {
            batch_id: batchId,
            status: 'queued',
            total_received: queueRows.length,
            message: 'Files uploaded and queued for background processing.',
          },
          { status: 202 }
        );
      }

      if (Array.isArray(body.resumes) && body.resumes.length > 0) {
        for (const item of body.resumes) {
          if (!item.text || typeof item.text !== 'string' || item.text.trim().length === 0) {
            return NextResponse.json(
              { error: `Item "${item.file_name || 'unnamed'}" does not contain valid text.` },
              { status: 400 }
            );
          }
          const textVal = item.text.trim();
          const fileName = item.file_name || 'resume.txt';
          processedResumes.push({
            file_name: fileName,
            file_type: item.file_type || resolveFileType(fileName),
            text: textVal,
            wordCount: textVal.split(/\s+/).filter(Boolean).length,
            charCount: textVal.length,
          });
        }
      } else if (body.text && typeof body.text === 'string' && body.text.trim().length > 0) {
        const textVal = body.text.trim();
        const fileName = body.fileName || body.file_name || 'pasted-resume.txt';
        processedResumes.push({
          file_name: fileName,
          file_type: resolveFileType(fileName),
          text: textVal,
          wordCount: textVal.split(/\s+/).filter(Boolean).length,
          charCount: textVal.length,
        });
      } else {
        return NextResponse.json(
          { error: 'Please provide at least one resume with non-empty text.' },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Unsupported Content-Type. Use multipart/form-data or application/json.' },
        { status: 400 }
      );
    }

    if (processedResumes.length === 0) {
      return NextResponse.json(
        { error: 'No valid resumes found to process.' },
        { status: 400 }
      );
    }

    // Determine target webhook URL for Candidate Resume (realtime mode)
    const customHeaderUrl = request.headers.get('x-webhook-url');
    const webhookUrl =
      (customWebhookUrl && customWebhookUrl.trim()) ||
      (customHeaderUrl && customHeaderUrl.trim()) ||
      process.env.N8N_CANDIDATE_RESUME_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_N8N_CANDIDATE_RESUME_WEBHOOK_URL ||
      '';

    const secret = process.env.N8N_SHARED_SECRET || '';

    // Generate unique batch ID
    const batchId = `batch_cand_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Register batch in Supabase upload_batches table
    await createBatch({
      id: batchId,
      userId: user.id,
      batchType: 'candidate',
      totalReceived: processedResumes.length,
      metadata: {
        file_names: processedResumes.map((r) => r.file_name),
      },
    });

    console.log(
      `[Candidate Resume Upload] Registered batch "${batchId}" with ${processedResumes.length} item(s). Starting async n8n processing...`
    );

    // Trigger asynchronous background worker without waiting for long-running workflow
    setImmediate(() => {
      processCandidateBatchAsync(batchId, user.id, processedResumes, webhookUrl, secret).catch(
        (err) => {
          console.error(`[Candidate Resume Upload] Background processing error for batch ${batchId}:`, err);
        }
      );
    });

    // Return accepted response with batch_id and processing status
    return NextResponse.json(
      {
        batch_id: batchId,
        status: 'processing',
        total_received: processedResumes.length,
        message: 'Files uploaded. Sending to n8n for processing...',
      },
      { status: 202 }
    );
  } catch (error: any) {
    console.error('Error processing resume file upload:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process and upload resume(s).' },
      { status: 500 }
    );
  }
}
