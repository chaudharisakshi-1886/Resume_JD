import '@/utils/dns-fix';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/auth';
import { extractTextFromFile, isSupportedFormat, resolveFileType } from '@/utils/documentParser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createBatch, processCandidateBatchAsync, updateBatchStatus } from '@/services/batchService';
import { sanitizeFileName } from '@/lib/upload-storage';
import { pool } from '@/database/db';
import { UploadBatchResponse } from '@/types';

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
      const positionId = (formData.get('position_id') || formData.get('positionId') || formData.get('jobId')) as string | null;

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

      // If QUEUED MODE: Save original uploaded file bytes directly without text conversion or encoding
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
        const uploadBaseDir = process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes';
        const targetDir = path.join(uploadBaseDir, 'incoming', 'candidates');
        await fs.promises.mkdir(targetDir, { recursive: true });

        const queuedFiles: { name: string; safeFileName: string; filePath: string }[] = [];

        // Save original uploaded file bytes exactly: read with Buffer.from(await file.arrayBuffer()) and write with fs.promises.writeFile
        for (const file of uploadedFiles) {
          const fileBuffer = Buffer.from(await file.arrayBuffer());
          const safeName = sanitizeFileName(file.name);
          const savedFileName = `${batchId}_${Date.now()}_${safeName}`;
          const filePath = path.join(targetDir, savedFileName);

          await fs.promises.writeFile(filePath, fileBuffer);

          queuedFiles.push({
            name: file.name,
            safeFileName: savedFileName,
            filePath,
          });
        }

        if (directText && directText.trim().length > 0) {
          const directName = sanitizeFileName((formData.get('fileName') as string) || 'manual-resume.txt');
          const savedFileName = `${batchId}_${Date.now()}_${directName}`;
          const filePath = path.join(targetDir, savedFileName);
          await fs.promises.writeFile(filePath, Buffer.from(directText.trim(), 'utf-8'));
          queuedFiles.push({
            name: directName,
            safeFileName: savedFileName,
            filePath,
          });
        }

        await createBatch({
          id: batchId,
          userId: user.id,
          batchType: 'candidate',
          totalReceived: queuedFiles.length,
          metadata: {
            file_names: queuedFiles.map((f) => f.name),
            mode: 'queued',
          },
        });

        for (const item of queuedFiles) {
          await pool.query(
            `INSERT INTO upload_queue (batch_id, user_id, position_id, file_name, file_path, file_type, status)
             VALUES ($1, $2, $3, $4, $5, 'candidate', 'pending')`,
            [batchId, user.id, positionId || null, item.safeFileName, item.filePath]
          );
        }

        await updateBatchStatus(batchId, {
          status: 'queued',
          message: `${queuedFiles.length} file(s) saved and queued for background processing.`,
        });

        return NextResponse.json(
          {
            batch_id: batchId,
            status: 'queued',
            total_received: queuedFiles.length,
            message: 'Files uploaded and queued for background processing.',
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

      if (isQueuedMode) {
        const jsonItems: { name: string; buffer: Buffer }[] = [];
        if (Array.isArray(body.resumes) && body.resumes.length > 0) {
          for (const item of body.resumes) {
            const rawBase64 = item.base64 || item.file_base64 || item.fileContent || item.file_content;
            if (rawBase64 && typeof rawBase64 === 'string') {
              jsonItems.push({
                name: item.file_name || 'resume.bin',
                buffer: Buffer.from(rawBase64, 'base64'),
              });
            } else if (item.text && typeof item.text === 'string' && item.text.trim().length > 0) {
              const name = item.file_name || 'resume.txt';
              const isBinaryDoc = /\.(pdf|docx?|xlsx?|csv)$/i.test(name);
              if (isBinaryDoc) {
                return NextResponse.json(
                  { error: `Cannot save extracted text as binary file "${name}". Please upload original file via multipart/form-data.` },
                  { status: 400 }
                );
              }
              jsonItems.push({
                name,
                buffer: Buffer.from(item.text.trim(), 'utf-8'),
              });
            }
          }
        } else if (body.text && typeof body.text === 'string' && body.text.trim().length > 0) {
          const directName = body.fileName || body.file_name || 'pasted-resume.txt';
          jsonItems.push({ name: directName, buffer: Buffer.from(body.text.trim(), 'utf-8') });
        }

        if (jsonItems.length === 0) {
          return NextResponse.json({ error: 'Please provide at least one resume with non-empty text or original file content.' }, { status: 400 });
        }

        const positionId = (body.position_id || body.positionId || body.jobId)?.toString() || null;
        const batchId = `batch_cand_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const uploadBaseDir = process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes';
        const targetDir = path.join(uploadBaseDir, 'incoming', 'candidates');
        await fs.promises.mkdir(targetDir, { recursive: true });

        await createBatch({
          id: batchId,
          userId: user.id,
          batchType: 'candidate',
          totalReceived: jsonItems.length,
          metadata: { file_names: jsonItems.map((j) => j.name), mode: 'queued' },
        });

        for (const item of jsonItems) {
          const safeName = sanitizeFileName(item.name);
          const savedFileName = `${batchId}_${Date.now()}_${safeName}`;
          const filePath = path.join(targetDir, savedFileName);

          await fs.promises.writeFile(filePath, item.buffer);

          await pool.query(
            `INSERT INTO upload_queue (batch_id, user_id, position_id, file_name, file_path, file_type, status)
             VALUES ($1, $2, $3, $4, $5, 'candidate', 'pending')`,
            [batchId, user.id, positionId, savedFileName, filePath]
          );
        }

        await updateBatchStatus(batchId, {
          status: 'queued',
          message: `${jsonItems.length} file(s) saved and queued for background processing.`,
        });

        return NextResponse.json(
          {
            batch_id: batchId,
            status: 'queued',
            total_received: jsonItems.length,
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

    // Required Resume Webhook Payload structure:
    const webhookPayload = {
      resumes: processedResumes.map((r) => ({
        file_name: r.file_name,
        file_type: r.file_type,
        text: r.text,
      })),
    };

    // Determine target webhook URL for Candidate Resume
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
    const batch = await createBatch({
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

    // Return accepted response with batch_id and processing status (never fabricated success counts)
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
