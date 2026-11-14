export const runtime = 'nodejs';

import '@/utils/dns-fix';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/auth';
import { extractTextFromFile, isSupportedFormat, resolveFileType } from '@/utils/documentParser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createBatch, processJobBatchAsync, updateBatchStatus } from '@/services/batchService';
import { sanitizeFileName } from '@/lib/upload-storage';
import { pool } from '@/database/db';
import { UploadBatchResponse } from '@/types';

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

      // If QUEUED MODE: Save original uploaded JD files directly without text conversion or encoding
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
        const uploadBaseDir = process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes';
        const targetDir = path.join(uploadBaseDir, 'incoming', 'jobs');
        await fs.promises.mkdir(targetDir, { recursive: true });

        const queuedFiles: { name: string; safeFileName: string; filePath: string }[] = [];

        for (const file of uploadedFiles) {
          const buffer = Buffer.from(await file.arrayBuffer());
          const safeName = sanitizeFileName(file.name);
          const savedFileName = `${batchId}_${Date.now()}_${safeName}`;
          const filePath = path.join(targetDir, savedFileName);

          await fs.promises.writeFile(filePath, buffer);

          const stat = await fs.promises.stat(filePath);
          if (stat.size <= 0 || stat.size !== buffer.length) {
            throw new Error(`File write verification failed for "${file.name}": saved size is ${stat.size} bytes, expected ${buffer.length} bytes.`);
          }

          queuedFiles.push({
            name: file.name,
            safeFileName: savedFileName,
            filePath,
          });
        }

        if (directText && directText.trim().length > 0) {
          const directName = sanitizeFileName((formData.get('fileName') as string) || 'manual-job-description.txt');
          const savedFileName = `${batchId}_${Date.now()}_${directName}`;
          const filePath = path.join(targetDir, savedFileName);
          const textBuffer = Buffer.from(directText.trim(), 'utf-8');
          await fs.promises.writeFile(filePath, textBuffer);
          const stat = await fs.promises.stat(filePath);
          if (stat.size <= 0 || stat.size !== textBuffer.length) {
            throw new Error(`File write verification failed for "${directName}": saved size is ${stat.size} bytes, expected ${textBuffer.length} bytes.`);
          }
          queuedFiles.push({
            name: directName,
            safeFileName: savedFileName,
            filePath,
          });
        }

        await createBatch({
          id: batchId,
          userId: user.id,
          batchType: 'job',
          totalReceived: queuedFiles.length,
          metadata: {
            file_names: queuedFiles.map((f) => f.name),
            mode: 'queued',
          },
        });

        for (const item of queuedFiles) {
          await pool.query(
            `INSERT INTO upload_queue (batch_id, user_id, position_id, file_name, file_path, file_type, status)
             VALUES ($1, $2, $3, $4, $5, 'job', 'pending')`,
            [batchId, user.id, positionId || null, item.safeFileName, item.filePath]
          );
        }

        await updateBatchStatus(batchId, {
          status: 'queued',
          message: `${queuedFiles.length} job file(s) saved and queued for background processing.`,
        });

        return NextResponse.json(
          {
            batch_id: batchId,
            status: 'queued',
            total_received: queuedFiles.length,
            message: 'Job descriptions uploaded and queued for background processing.',
          },
          { status: 202 }
        );
      }

      // Process each file in the order uploaded
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

      if (isQueuedMode) {
        const jsonItems: { name: string; buffer: Buffer; positionId?: string | null }[] = [];
        if (Array.isArray(body.job_descriptions) && body.job_descriptions.length > 0) {
          for (const item of body.job_descriptions) {
            const rawData = item.base64 || item.file_base64 || item.fileContent || item.data || item.text || item.description;
            if (rawData && typeof rawData === 'string') {
              const cleanBase64 = rawData.replace(/^data:[^;]+;base64,/, '').trim();
              const buffer = Buffer.from(cleanBase64, 'base64');
              jsonItems.push({
                name: item.file_name || 'job_description.pdf',
                buffer,
                positionId: item.position_id || null,
              });
            }
          }
        } else if ((body.text || body.description) && typeof (body.text || body.description) === 'string') {
          const directName = body.fileName || body.file_name || 'pasted-job-description.txt';
          const textVal = (body.text || body.description).trim();
          jsonItems.push({
            name: directName,
            buffer: Buffer.from(textVal, 'utf-8'),
            positionId: body.position_id || null,
          });
        }

        if (jsonItems.length === 0) {
          return NextResponse.json({ error: 'Please provide at least one job description with valid content.' }, { status: 400 });
        }

        const batchId = `batch_job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const uploadBaseDir = process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes';
        const targetDir = path.join(uploadBaseDir, 'incoming', 'jobs');
        await fs.promises.mkdir(targetDir, { recursive: true });

        await createBatch({
          id: batchId,
          userId: user.id,
          batchType: 'job',
          totalReceived: jsonItems.length,
          metadata: { file_names: jsonItems.map((j) => j.name), mode: 'queued' },
        });

        for (const item of jsonItems) {
          const safeName = sanitizeFileName(item.name);
          const savedFileName = `${batchId}_${Date.now()}_${safeName}`;
          const filePath = path.join(targetDir, savedFileName);

          await fs.promises.writeFile(filePath, item.buffer);

          const stat = await fs.promises.stat(filePath);
          if (stat.size <= 0 || stat.size !== item.buffer.length) {
            throw new Error(`File write verification failed for "${item.name}": saved size is ${stat.size} bytes, expected ${item.buffer.length} bytes.`);
          }

          await pool.query(
            `INSERT INTO upload_queue (batch_id, user_id, position_id, file_name, file_path, file_type, status)
             VALUES ($1, $2, $3, $4, $5, 'job', 'pending')`,
            [batchId, user.id, item.positionId || null, savedFileName, filePath]
          );
        }

        await updateBatchStatus(batchId, {
          status: 'queued',
          message: `${jsonItems.length} job file(s) saved and queued for background processing.`,
        });

        return NextResponse.json(
          {
            batch_id: batchId,
            status: 'queued',
            total_received: jsonItems.length,
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

    // Required Job Description Webhook Payload structure
    const webhookPayload = {
      job_descriptions: processedJDs.map((j) => {
        const payloadItem: any = {
          file_name: j.file_name,
          file_type: j.file_type,
        };
        if (j.text !== undefined) payloadItem.text = j.text;
        if (j.position_id !== undefined) payloadItem.position_id = j.position_id;
        if (j.job_title !== undefined) payloadItem.job_title = j.job_title;
        if (j.description !== undefined) payloadItem.description = j.description;
        return payloadItem;
      }),
    };

    // Determine target webhook URL for Job Description
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
    const batch = await createBatch({
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

    // Return accepted response with batch_id and processing status (never fabricated success counts)
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
