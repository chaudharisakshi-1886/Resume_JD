import { extractTextFromFile, ExtractedDocument, isSupportedFormat, resolveFileType } from '@/utils/documentParser';

export { isSupportedFormat, resolveFileType };

/**
 * Extracts clean plain text from a resume or job description document buffer.
 */
export async function extractText(
  buffer: Buffer,
  fileName: string,
  fileType?: string
): Promise<ExtractedDocument> {
  return await extractTextFromFile(buffer, fileName, fileType);
}

export interface N8nWebhookResponse {
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}

/**
 * Sends a structured payload to an n8n webhook URL.
 * Automatically handles manual redirects (HTTP 301/302) to prevent POST -> GET payload drops.
 */
export async function sendToN8nWebhook(
  payload: any,
  webhookUrl?: string,
  secret?: string
): Promise<N8nWebhookResponse> {
  const targetUrl = (
    webhookUrl ||
    process.env.N8N_CANDIDATE_RESUME_WEBHOOK_URL ||
    process.env.NEXT_PUBLIC_N8N_CANDIDATE_RESUME_WEBHOOK_URL ||
    ''
  ).trim();

  if (!targetUrl) {
    return {
      ok: false,
      status: 400,
      error: 'Target n8n webhook URL is not configured.',
    };
  }

  const authSecret = secret || process.env.N8N_SHARED_SECRET || '';

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': authSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
      redirect: 'manual',
    });

    // Detect HTTP -> HTTPS redirects (301/302/307/308) before POST body is dropped
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') || '';
      return {
        ok: false,
        status: res.status,
        error: `Redirect detected (HTTP ${res.status}) to ${location}. Use the HTTPS URL directly.`,
      };
    }

    const rawText = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }

    if (!res.ok) {
      const errDetail =
        (typeof parsed === 'object' && (parsed?.message || parsed?.error)) ||
        `n8n returned HTTP ${res.status}`;
      return {
        ok: false,
        status: res.status,
        data: parsed,
        error: errDetail,
      };
    }

    return {
      ok: true,
      status: res.status,
      data: parsed,
    };
  } catch (err: any) {
    const cause = err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : '';
    const detail = cause ? `${err.message} (${cause})` : (err.message || 'Network error');
    return {
      ok: false,
      status: 500,
      error: `${detail} — called: ${targetUrl}`,
    };
  }
}

