'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle,
  Layers,
  Info,
  Loader2, 
  FileText, 
  ArrowLeft, 
  Copy, 
  Check, 
  FileCode,
  Sparkles,
  Briefcase,
  X,
  Play,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Send
} from 'lucide-react';
import { extractTextFromClientFile, extractPdfTextInBrowser, validateExtractedPdfText } from '@/utils/clientPdfParser';
interface ProcessedJDItem {
  position_id?: string | null;
  job_title?: string;
  description?: string;
  file_name: string;
  file_type: string;
  text?: string;
  wordCount: number;
  charCount: number;
}

interface BatchJDResult {
  success: boolean;
  count: number;
  job_descriptions: ProcessedJDItem[];
  webhookPayload: {
    job_descriptions: Array<{
      position_id?: string | null;
      job_title?: string;
      description?: string;
      file_name: string;
      file_type: string;
      text?: string;
    }>;
  };
  webhookSuccess: boolean;
  webhookStatus: number;
  webhookMessage: string;
  webhookUrl: string;
  webhookResponse?: any;
  skippedPosIdCount?: number;
  skippedJdCount?: number;
}

import { UploadBatchResponse, UploadBatchStatusResponse, UploadRecordDetail } from '@/types';
import { useBatchPolling } from '@/utils/useBatchPolling';
import { WebhookConfigBanner } from '@/components/WebhookConfigBanner';
import { apiFetch } from '@/utils/apiClient';

export default function UploadJobDescriptionPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUploadingRef = useRef(false);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadStage, setUploadStage] = useState<'idle' | 'initiated' | 'processing' | 'completed'>('idle');
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [manualText, setManualText] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [expandedFileIdx, setExpandedFileIdx] = useState<number | null>(null);
  const [copiedTextIdx, setCopiedTextIdx] = useState<number | null>(null);
  const [envDefaultWebhook, setEnvDefaultWebhook] = useState<string>(
    process.env.NEXT_PUBLIC_N8N_JD_WEBHOOK_URL || 'https://pooja456.app.n8n.cloud/webhook-test/jd-upload'
  );
  const [webhookUrl, setWebhookUrl] = useState<string>(
    process.env.NEXT_PUBLIC_N8N_JD_WEBHOOK_URL || ''
  );

  const {
    activeBatchId,
    batchResult,
    setBatchResult,
    isTimedOut,
    startPolling,
    checkStatusNow,
    resetPolling,
    pollingError,
    uiState,
  } = useBatchPolling({
    storageKey: 'active_jd_upload_batch',
    onCompleted: (result) => {
      setUploadStage('completed');
      if (
        result.status === 'failed' ||
        (result.failed_count > 0 && result.inserted_count === 0 && result.duplicate_count === 0)
      ) {
        setError(result.message || 'All job descriptions failed to process.');
      }
    },
    onError: (err) => {
      setError(err);
    },
  });

  const isProcessing = uploadStage === 'initiated' || uiState === 'processing';


  React.useEffect(() => {
    // Check if custom browser override exists in localStorage
    const saved = localStorage.getItem('n8n_jd_webhook_url');
    if (saved && saved.trim()) {
      setWebhookUrl(saved.trim());
    }

    // Always fetch the current .env webhook from the server
    apiFetch('/api/settings/defaults')
      .then((res) => res.json())
      .then((data) => {
        if (data?.envJdWebhook) {
          setEnvDefaultWebhook(data.envJdWebhook);
          if (!saved || !saved.trim()) {
            setWebhookUrl(data.envJdWebhook);
          }
        }
      })
      .catch((err) => console.error('Failed to fetch JD webhook from settings:', err));
  }, []);

  // Helper: format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Add files to selection (maintaining order)
  const handleAddFiles = (files: FileList | File[]) => {
    setError(null);
    resetPolling();
    setUploadStage('idle');
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setSelectedFiles((prev) => [...prev, ...fileArray]);

    // Pre-validate any PDF files eagerly
    for (const file of fileArray) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (ext === 'pdf' || file.type === 'application/pdf') {
        extractPdfTextInBrowser(file)
          .then((text) => {
            if (!validateExtractedPdfText(text)) {
              setError('PDF text extraction failed');
            }
          })
          .catch(() => {
            setError('PDF text extraction failed');
          });
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleAddFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  };

  // Add manual text as a virtual file
  const handleAddManualText = () => {
    if (!manualText.trim()) {
      setError('Please enter job description text.');
      return;
    }

    const title = manualTitle.trim() || `pasted-job-description-${Date.now().toString().slice(-4)}.txt`;
    const textBlob = new Blob([manualText.trim()], { type: 'text/plain' });
    const file = new File([textBlob], title.endsWith('.txt') ? title : `${title}.txt`, { type: 'text/plain' });

    handleAddFiles([file]);
    setManualText('');
    setManualTitle('');
    setShowManualInput(false);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleClearAll = () => {
    setSelectedFiles([]);
    resetPolling();
    setError(null);
    setUploadStage('idle');
  };

  // Upload and Send ALL selected files in ONE single webhook request
  const handleUploadAll = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one job description file to upload.');
      return;
    }

    if (isUploadingRef.current || isProcessing) return;
    isUploadingRef.current = true;

    setError(null);
    setBatchSummary(null);
    resetPolling();
    // State 1: Upload initiated
    setUploadStage('initiated');

    try {
      // 1. Extract real readable text from each selected file using client-side extraction
      const jobDescriptionsPayload: Array<{
        position_id?: string | null;
        job_title?: string;
        description?: string;
        file_name: string;
        file_type: string;
        text?: string;
      }> = [];
      const totalSkippedPosIdCount = 0;
      const totalSkippedJdCount = 0;

      for (const file of selectedFiles) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isPdf = ext === 'pdf' || file.type === 'application/pdf';
        const isExcelOrCsv = ['xlsx', 'xls', 'csv'].includes(ext);

        if (isExcelOrCsv) {
          try {
            const XLSX = await import('xlsx');
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            
            // 1. Use sheet_to_json with header: 1
            const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

            if (rows.length === 0) {
              setError(`File "${file.name}" has no data rows.`);
              return;
            }

            // 2. Detect header row
            let idCol = 0, titleCol = 1, descCol = 2;
            let hasHeader = false;
            
            const firstRow = rows[0].map((cell: any) => String(cell).toLowerCase().replace(/[\s_]+/g, ''));
            const idMatch = firstRow.findIndex((c: string) => /id|code/i.test(c));
            const titleMatch = firstRow.findIndex((c: string) => /title|role|positionname/i.test(c));
            const descMatch = firstRow.findIndex((c: string) => /description|jd/i.test(c));
            
            if (idMatch !== -1 && titleMatch !== -1 && descMatch !== -1) {
              hasHeader = true;
              idCol = idMatch;
              titleCol = titleMatch;
              descCol = descMatch;
            }

            const dataRows = hasHeader ? rows.slice(1) : rows;
            let readCount = 0;
            let skippedMissingDesc = 0;

            const validRows: any[] = [];
            for (const row of dataRows) {
              if (!row || row.length === 0) continue;
              readCount++;
              
              const posId = row[idCol] ? String(row[idCol]).trim() : null;
              const jobTitle = row[titleCol] ? String(row[titleCol]).trim() : '';
              const jdText = row[descCol] ? String(row[descCol]).trim() : '';

              if (!jdText) {
                skippedMissingDesc++;
                continue;
              }

              validRows.push({ posId, jobTitle, jdText });
            }

            let duplicatesRemoved = 0;
            let uniqueCount = 0;
            const seenPosIds = new Set<string>();
            const seenTexts = new Set<string>();

            // Deduplicate within the current upload batch
            for (const r of validRows) {
              const isDuplicate = 
                (r.posId && seenPosIds.has(r.posId)) || 
                seenTexts.has(r.jdText);

              if (isDuplicate) {
                duplicatesRemoved++;
                continue;
              }

              if (r.posId) seenPosIds.add(r.posId);
              seenTexts.add(r.jdText);
              uniqueCount++;

              jobDescriptionsPayload.push({
                position_id: r.posId,
                job_title: r.jobTitle,
                description: r.jdText,
                file_name: file.name,
                file_type: 'xlsx'
              });
            }

            // We'll show the summary as a success message or attach it to the result later
            // The prompt says: show the user a summary: "N rows read, N unique, N missing ID, N duplicates removed".
            if (readCount > 0) {
              const missingIdCount = readCount - uniqueCount - duplicatesRemoved; // Wait, actually it's just how many have missing ID
              const missingId = validRows.filter(r => !r.posId).length;
              setBatchSummary(prev => prev ? prev + `\n${file.name}: ${readCount} rows read, ${uniqueCount} unique, ${missingId} missing ID, ${duplicatesRemoved} duplicates removed.` : `${file.name}: ${readCount} rows read, ${uniqueCount} unique, ${missingId} missing ID, ${duplicatesRemoved} duplicates removed.`);
            }

            continue;
          } catch (xlsxErr) {
            console.warn('xlsx parse failed, falling back to text extraction:', xlsxErr);
          }
        }

        // ── Generic extraction (PDF, DOCX, plain text, non-JD CSVs) ──
        let extracted;
        try {
          extracted = await extractTextFromClientFile(file);
        } catch (extractErr: any) {
          if (isPdf) {
            setError('PDF text extraction failed');
            setUploadStage('idle');
            return;
          }
          throw extractErr;
        }

        const textVal = extracted.text ? extracted.text.trim() : '';

        // Validate PDF extraction before sending the webhook
        if (isPdf) {
          if (!validateExtractedPdfText(textVal)) {
            setError('PDF text extraction failed');
            setUploadStage('idle');
            return;
          }
        }

        if (!textVal) {
          setError(`File "${file.name}" appears to be empty or unreadable.`);
          setUploadStage('idle');
          return;
        }

        let extractedPosId: string | null = null;
        if (isPdf || ['txt', 'doc', 'docx'].includes(ext)) {
          // Look for "Position ID: XXX" or "Job ID: XXX" etc.
          const match = textVal.match(/(?:position id|job id|job code|requisition id)\s*[:\-]?\s*([a-zA-Z0-9\-_]+)/i);
          if (match && match[1]) {
            extractedPosId = match[1].trim();
          }
        }

        // Read file bytes as base64 so queued mode receives the exact byte-for-byte binary file
        const fileBuffer = await file.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(fileBuffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const fileBase64 = btoa(binary);

        jobDescriptionsPayload.push({
          position_id: extractedPosId,
          file_name: extracted.fileName,
          file_type: extracted.fileType,
          text: textVal,
          base64: fileBase64,
        } as any);
      }

      // Final pre-webhook validation check across all items:
      for (const jd of jobDescriptionsPayload) {
        const isPdf = jd.file_type === 'application/pdf' || jd.file_name.toLowerCase().endsWith('.pdf');
        if (isPdf && !validateExtractedPdfText(jd.text || '')) {
          setError('PDF text extraction failed');
          setUploadStage('idle');
          return;
        }
      }

      // 2. Pre-check: If all items were skipped locally (e.g. from Excel duplicate checks)
      if (jobDescriptionsPayload.length === 0) {
        if (totalSkippedPosIdCount > 0 || totalSkippedJdCount > 0) {
           setError(`All rows were skipped as duplicates (${totalSkippedPosIdCount} by Position_ID, ${totalSkippedJdCount} by JD).`);
        } else {
           setError('No valid data found to upload.');
        }
        setUploadStage('idle');
        return;
      }

      // Submit to backend API route and receive batch_id plus processing status
      const res = await apiFetch('/api/jobs/upload-jd-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          job_descriptions: jobDescriptionsPayload,
          webhook_url: webhookUrl?.trim() || undefined,
        }),
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error('Server returned an unparseable response.');
      }

      if (!res.ok) {
        throw new Error(data?.error || data?.message || 'Failed to initiate job description processing.');
      }

      if (data?.batch_id) {
        // State 2: n8n is processing in background
        setUploadStage('processing');
        startPolling(data.batch_id);
      } else {
        throw new Error('Upload response did not return a valid batch ID.');
      }
    } catch (err: any) {
      console.error('Batch JD upload error:', err);
      setError(err.message || 'An error occurred while uploading job descriptions.');
      setUploadStage('idle');
    } finally {
      isUploadingRef.current = false;
    }
  };


  const handleCopyText = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTextIdx(index);
    setTimeout(() => setCopiedTextIdx(null), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between pb-6 border-b border-neutral-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Upload Job Descriptions
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Upload job description documents (.pdf, .docx, .doc, .xlsx, .xls, .txt, or .csv) to extract requirements and skills for candidate matching.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/dashboard/jobs')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 shadow-xs border border-neutral-300 hover:bg-neutral-50 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Jobs
          </button>
        </div>
      </div>

      {/* Webhook Configuration & Diagnostic Banner */}
      <WebhookConfigBanner
        title="Job Description n8n Webhook"
        storageKey="n8n_jd_webhook_url"
        currentUrl={webhookUrl}
        onUrlChange={setWebhookUrl}
        envDefaultUrl={envDefaultWebhook}
      />

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-800 animate-in fade-in duration-150">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm font-medium">{error}</div>
          <button
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Upload Dropzone */}
      <div className="space-y-4">
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all cursor-pointer ${
            dragActive
              ? 'border-indigo-500 bg-indigo-50/50 scale-[1.005]'
              : 'border-neutral-300 hover:border-indigo-400 bg-white hover:bg-neutral-50/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xlsx,.xls,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/plain,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="mx-auto w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-4 shadow-inner">
            <UploadCloud className="h-8 w-8" />
          </div>

          <h3 className="text-base font-bold text-neutral-900">
            Drop job description file(s) here, or <span className="text-indigo-600 underline">browse</span>
          </h3>
          <p className="text-xs text-neutral-500 mt-1.5 max-w-md mx-auto">
            Supports <span className="font-semibold text-neutral-700">PDF, Word (.docx, .doc), Excel (.xlsx, .xls), CSV, and Text (.txt)</span> files. You can select multiple files at once.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {['PDF (.pdf)', 'Word (.docx, .doc)', 'Excel (.xlsx, .xls)', 'CSV (.csv)', 'Text (.txt)'].map((fmt) => (
              <span
                key={fmt}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-neutral-100 text-neutral-600"
              >
                <FileCode className="h-3 w-3 text-neutral-500" />
                {fmt}
              </span>
            ))}
          </div>
        </div>

        {/* Manual Paste Toggle Button */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowManualInput(!showManualInput)}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 cursor-pointer"
          >
            {showManualInput ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showManualInput ? 'Hide direct text paste' : '+ Paste raw JD text manually'}
          </button>
          <span className="text-xs text-neutral-400">
            {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected
          </span>
        </div>

        {/* Manual Text Input Drawer */}
        {showManualInput && (
          <div className="bg-white rounded-xl border border-neutral-200 p-5 space-y-3 shadow-xs animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-700">
                Paste Job Description Text
              </span>
              <span className="text-[11px] text-neutral-400">
                {manualText.length} characters | {manualText.split(/\s+/).filter(Boolean).length} words
              </span>
            </div>

            <input
              type="text"
              placeholder="Job Title or Code (e.g. Senior Backend Engineer - JD-04)"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans"
            />

            <textarea
              rows={6}
              placeholder="Paste raw job description text here... (responsibilities, requirements, qualifications)"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              className="w-full text-xs font-mono p-3 rounded-lg border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
            />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowManualInput(false);
                  setManualText('');
                  setManualTitle('');
                }}
                className="px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddManualText}
                disabled={!manualText.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer shadow-xs"
              >
                <Play className="h-3 w-3" />
                Add to Selected Batch
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Selected Files Staging List (Before / After Upload) */}
      {selectedFiles.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <span>Selected Job Descriptions</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {selectedFiles.length} {selectedFiles.length === 1 ? 'file' : 'files'}
                  </span>
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} ready for upload and processing.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={isProcessing}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg text-neutral-600 hover:text-red-600 hover:bg-neutral-100 disabled:opacity-50 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear List
                </button>
                <button
                  type="button"
                  onClick={handleUploadAll}
                  disabled={isProcessing || selectedFiles.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer shadow-sm transition-all"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Processing & Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      <span>Upload {selectedFiles.length} Job Description{selectedFiles.length === 1 ? '' : 's'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Selected File Items */}
            <div className="divide-y divide-neutral-100 border-t border-neutral-100 pt-1">
              {selectedFiles.map((file, idx) => {
                const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
                return (
                  <div key={`${file.name}-${idx}`} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-neutral-400 text-[11px] w-5">#{idx + 1}</span>
                      <Briefcase className="h-4 w-4 text-indigo-600 shrink-0" />
                      <span className="font-medium text-neutral-900 truncate max-w-sm sm:max-w-md">{file.name}</span>
                      <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 shrink-0">
                        {ext}
                      </span>
                      <span className="text-neutral-400 text-[11px] shrink-0">{formatFileSize(file.size)}</span>
                    </div>

                    {!isProcessing && !batchResult && (
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(idx)}
                        className="p-1 text-neutral-400 hover:text-red-600 rounded hover:bg-neutral-100 cursor-pointer"
                        title="Remove from batch"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* State 1 & State 2: Background Processing Indicator */}
      {isProcessing && (
        <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-6 shadow-xs animate-in fade-in duration-200 space-y-3">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-indigo-100 text-indigo-700 rounded-xl shrink-0 mt-0.5">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-neutral-900">
                  {uploadStage === 'initiated'
                    ? 'Uploading Job Descriptions'
                    : 'Processing Job Descriptions'}
                </h3>
                {activeBatchId && (
                  <span className="text-[11px] font-mono text-neutral-500 bg-white px-2 py-0.5 rounded border border-neutral-200">
                    Batch #{activeBatchId.slice(-8)}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-neutral-700">
                {uploadStage === 'initiated'
                  ? 'Files uploaded. Sending to n8n for processing...'
                  : 'Processing job descriptions, checking duplicates, and saving records to Supabase. Please wait...'}
              </p>
              <div className="w-full bg-indigo-100/70 rounded-full h-1.5 overflow-hidden mt-3">
                <div className="bg-indigo-600 h-1.5 rounded-full w-2/3 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeout Recovery Banner */}
      {isTimedOut && !batchResult && (
        <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in duration-200">
          <div className="flex items-start gap-3.5">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-amber-900">Processing In Progress</h4>
              <p className="text-xs text-amber-800 mt-0.5">
                Processing is taking longer than expected. Your batch status is still being checked.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={checkStatusNow}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 shadow-xs cursor-pointer shrink-0"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Check Status Again
          </button>
        </div>
      )}

      {/* Batch Result Inspection Card */}
      {batchResult && !isProcessing && (
        <div className="space-y-5 animate-in fade-in duration-200">
          {/* 1. Header Banner based on results */}
          <div
            className={`p-5 rounded-2xl border shadow-xs space-y-4 ${
              batchResult.inserted_count > 0 && batchResult.duplicate_count === 0 && batchResult.failed_count === 0
                ? 'bg-emerald-50/70 border-emerald-200'
                : batchResult.inserted_count === 0 && batchResult.duplicate_count > 0 && batchResult.failed_count === 0
                ? 'bg-amber-50/70 border-amber-200'
                : batchResult.inserted_count === 0 && batchResult.failed_count > 0
                ? 'bg-red-50/70 border-red-200'
                : 'bg-white border-neutral-200'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={`p-2.5 rounded-xl mt-0.5 shrink-0 ${
                    batchResult.inserted_count > 0 && batchResult.duplicate_count === 0 && batchResult.failed_count === 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : batchResult.inserted_count === 0 && batchResult.duplicate_count > 0 && batchResult.failed_count === 0
                      ? 'bg-amber-100 text-amber-700'
                      : batchResult.inserted_count === 0 && batchResult.failed_count > 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-indigo-100 text-indigo-700'
                  }`}
                >
                  {batchResult.inserted_count > 0 && batchResult.duplicate_count === 0 && batchResult.failed_count === 0 ? (
                    <CheckCircle2 className="h-6 w-6" />
                  ) : batchResult.inserted_count === 0 && batchResult.duplicate_count > 0 && batchResult.failed_count === 0 ? (
                    <AlertTriangle className="h-6 w-6" />
                  ) : batchResult.inserted_count === 0 && batchResult.failed_count > 0 ? (
                    <AlertCircle className="h-6 w-6" />
                  ) : (
                    <Layers className="h-6 w-6" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900 flex flex-wrap items-center gap-2">
                    <span>
                      {batchResult.inserted_count > 0 && batchResult.duplicate_count === 0 && batchResult.failed_count === 0
                        ? 'All Job Descriptions Inserted Successfully'
                        : batchResult.inserted_count === 0 && batchResult.duplicate_count > 0 && batchResult.failed_count === 0
                        ? 'Duplicate Job Descriptions Found'
                        : batchResult.inserted_count === 0 && batchResult.failed_count > 0
                        ? 'Job Description Upload Failed'
                        : 'Upload Results Summary'}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 border border-neutral-200">
                      {batchResult.total_received} Total Received
                    </span>
                  </h3>
                  {/* Granular Feedback Messages */}
                  <div className="mt-2 space-y-1.5 text-xs">
                    {batchResult.message ? (
                      <p className="font-semibold text-neutral-800 text-sm leading-relaxed">{batchResult.message}</p>
                    ) : (
                      <>
                        {batchResult.inserted_count > 0 && (
                          <div className="flex items-center gap-2 font-semibold text-emerald-800">
                            <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                            <span>
                              {batchResult.inserted_count} job description{batchResult.inserted_count === 1 ? '' : 's'} inserted successfully into Supabase.
                            </span>
                          </div>
                        )}
                        {batchResult.duplicate_count > 0 && (
                          <div className="flex items-center gap-2 font-semibold text-amber-800">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                            <span>
                              {batchResult.duplicate_count} duplicate JD skipped.
                            </span>
                          </div>
                        )}
                        {batchResult.failed_count > 0 && (
                          <div className="flex items-center gap-2 font-semibold text-red-800">
                            <X className="h-4 w-4 text-red-600 shrink-0" />
                            <span>
                              {batchResult.failed_count} job description{batchResult.failed_count === 1 ? '' : 's'} failed.
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {batchSummary && (
                      <p className="text-xs text-amber-600 font-medium mt-1 whitespace-pre-wrap">
                        {batchSummary}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Status Counter Badges */}
              <div className="flex flex-wrap sm:flex-col items-start sm:items-end gap-1.5 shrink-0 pt-2 sm:pt-0">
                {batchResult.inserted_count > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    {batchResult.inserted_count} Inserted
                  </span>
                )}
                {batchResult.duplicate_count > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    {batchResult.duplicate_count} Duplicate{batchResult.duplicate_count === 1 ? '' : 's'} Skipped
                  </span>
                )}
                {batchResult.failed_count > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-300">
                    {batchResult.failed_count} Failed
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 2. Categorized Record Lists */}
          {/* A. Successfully Inserted Records */}
          {((batchResult.inserted_job_descriptions && batchResult.inserted_job_descriptions.length > 0) ||
            (batchResult.inserted_records && batchResult.inserted_records.length > 0)) && (
            <div className="bg-white rounded-xl border border-neutral-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>
                    Successfully Inserted (
                    {(batchResult.inserted_job_descriptions || batchResult.inserted_records || []).length}
                    )
                  </span>
                </span>
                <span className="text-[11px] text-neutral-400">Added to database</span>
              </div>
              <div className="space-y-2">
                {(batchResult.inserted_job_descriptions || batchResult.inserted_records || []).map((item, idx) => {
                  const isExpanded = expandedFileIdx === idx;
                  return (
                    <div key={`inserted-${item.file_name}-${idx}`} className="border border-neutral-200 rounded-lg overflow-hidden">
                      <div className="p-3.5 bg-neutral-50 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono text-neutral-400 text-[11px] w-5">#{idx + 1}</span>
                          <Briefcase className="h-4 w-4 text-emerald-600 shrink-0" />
                          <span className="font-semibold text-neutral-900 truncate max-w-xs sm:max-w-md">
                            {item.job_title || item.file_name}
                          </span>
                          {item.job_code && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold shrink-0">
                              {item.job_code}
                            </span>
                          )}
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                            Inserted
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {(item.text || item.description) && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCopyText(idx, item.text || item.description || '')}
                                className="p-1 text-neutral-500 hover:text-neutral-900 text-xs font-medium flex items-center gap-1 cursor-pointer"
                              >
                                {copiedTextIdx === idx ? (
                                  <span className="text-emerald-600 font-semibold">Copied!</span>
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setExpandedFileIdx(isExpanded ? null : idx)}
                                className="p-1 text-neutral-500 hover:text-neutral-900 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <span>{isExpanded ? 'Hide Text' : 'View Text'}</span>
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {isExpanded && (item.text || item.description) && (
                        <div className="p-4 bg-white border-t border-neutral-200 space-y-2">
                          <div className="p-3 bg-neutral-50 rounded border border-neutral-200 max-h-56 overflow-y-auto font-mono text-xs text-neutral-800 leading-relaxed whitespace-pre-wrap select-all">
                            {item.text || item.description}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* B. Duplicate Skipped Records */}
          {((batchResult.duplicate_job_descriptions && batchResult.duplicate_job_descriptions.length > 0) ||
            (batchResult.duplicate_records && batchResult.duplicate_records.length > 0)) && (
            <div className="bg-white rounded-xl border border-amber-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  <span>
                    Duplicate Records Skipped (
                    {(batchResult.duplicate_job_descriptions || batchResult.duplicate_records || []).length}
                    )
                  </span>
                </span>
                <span className="text-[11px] text-amber-600 font-medium">Already exists in Supabase</span>
              </div>
              <div className="space-y-2">
                {(batchResult.duplicate_job_descriptions || batchResult.duplicate_records || []).map((item, idx) => (
                  <div key={`dup-${item.file_name}-${idx}`} className="border border-amber-200 rounded-lg p-3.5 bg-amber-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="font-semibold text-neutral-900 truncate max-w-xs sm:max-w-md">
                        {item.job_title || item.file_name}
                      </span>
                      {item.job_code && item.job_code !== 'N/A' && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold shrink-0">
                          {item.job_code}
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                        Duplicate Skipped
                      </span>
                    </div>
                    <span className="text-xs text-amber-700 italic shrink-0">
                      {item.reason || 'Record already present in Supabase.'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* C. Failed Records */}
          {((batchResult.failed_job_descriptions && batchResult.failed_job_descriptions.length > 0) ||
            (batchResult.failed_records && batchResult.failed_records.length > 0)) && (
            <div className="bg-white rounded-xl border border-red-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-red-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span>
                    Failed Records (
                    {(batchResult.failed_job_descriptions || batchResult.failed_records || []).length}
                    )
                  </span>
                </span>
                <span className="text-[11px] text-red-600 font-medium">Action required</span>
              </div>
              <div className="space-y-2">
                {(batchResult.failed_job_descriptions || batchResult.failed_records || []).map((item, idx) => (
                  <div key={`failed-${item.file_name}-${idx}`} className="border border-red-200 rounded-lg p-3.5 bg-red-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                      <span className="font-semibold text-neutral-900 truncate max-w-xs sm:max-w-md">
                        {item.file_name || 'Job Description Document'}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-300 shrink-0">
                        Failed
                      </span>
                    </div>
                    <span className="text-xs text-red-700 font-medium shrink-0">
                      {item.error || 'Failed to process document.'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Action Footer / Directory Link */}
          {batchResult.inserted_count > 0 && (
            <div className="p-5 bg-emerald-50/70 border border-emerald-200 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-100 text-emerald-800">
                  <FileCheck className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-emerald-900">
                    {batchResult.inserted_count} New {batchResult.inserted_count === 1 ? 'Job Description' : 'Job Descriptions'} Ready
                  </h4>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Inserted records are now stored in Supabase and available for candidate matching and evaluation.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push('/dashboard/jobs')}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 text-xs font-semibold shadow-xs cursor-pointer text-center"
              >
                View Jobs Directory →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
