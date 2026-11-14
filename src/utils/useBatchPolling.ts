import { useState, useRef, useCallback, useEffect } from 'react';
import { UploadBatchStatusResponse } from '@/types';
import { apiFetch } from '@/utils/apiClient';
import {
  registerActiveUpload,
  unregisterActiveUpload,
  registerCancellationCallback,
} from '@/utils/session';

export interface UseBatchPollingOptions {
  storageKey?: string;
  pollIntervalMs?: number;
  maxAttempts?: number;
  onCompleted?: (result: UploadBatchStatusResponse) => void;
  onError?: (errorMessage: string) => void;
}

export type UploadUiState =
  | 'idle'
  | 'initiating'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export function useBatchPolling(options: UseBatchPollingOptions = {}) {
  const {
    storageKey,
    pollIntervalMs = 2500,
    maxAttempts = 40, // 40 * 2.5s = ~100s timeout window
    onCompleted,
    onError,
  } = options;

  const [uiState, setUiState] = useState<UploadUiState>('idle');
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<UploadBatchStatusResponse | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isPollingRef = useRef(false);
  const attemptCountRef = useRef(0);
  const consecutiveNetworkErrorsRef = useRef(0);
  const currentBatchIdRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const abortActiveRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const resetPolling = useCallback(() => {
    clearTimer();
    abortActiveRequest();
    if (currentBatchIdRef.current) {
      unregisterActiveUpload(currentBatchIdRef.current);
      currentBatchIdRef.current = null;
    }
    isPollingRef.current = false;
    attemptCountRef.current = 0;
    consecutiveNetworkErrorsRef.current = 0;
    setUiState('idle');
    setActiveBatchId(null);
    setBatchResult(null);
    setPollingError(null);
    setIsTimedOut(false);
    if (storageKey && typeof window !== 'undefined') {
      sessionStorage.removeItem(storageKey);
    }
  }, [clearTimer, abortActiveRequest, storageKey]);

  const pollBatchStatus = useCallback(
    async (batchId: string) => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;

      abortActiveRequest();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        // Use centralized apiFetch wrapper (handles 401 and AbortError globally)
        const res = await apiFetch(`/api/batches/${encodeURIComponent(batchId)}`, {
          signal: controller.signal,
          headers: {
            'Cache-Control': 'no-cache, no-store',
          },
        });

        consecutiveNetworkErrorsRef.current = 0;

        if (res.status === 404) {
          isPollingRef.current = false;
          unregisterActiveUpload(batchId);
          currentBatchIdRef.current = null;
          setUiState('failed');
          const msg = `Batch "${batchId}" not found.`;
          setPollingError(msg);
          if (onError) onError(msg);
          if (storageKey && typeof window !== 'undefined') {
            sessionStorage.removeItem(storageKey);
          }
          return;
        }

        if (res.status === 401 || res.status === 403) {
          isPollingRef.current = false;
          unregisterActiveUpload(batchId);
          currentBatchIdRef.current = null;
          setUiState('failed');
          return;
        }

        let data: UploadBatchStatusResponse | null = null;
        try {
          data = await res.json();
        } catch {
          console.warn('[useBatchPolling] Received unparseable JSON response.');
        }

        if (!data || typeof data !== 'object') {
          attemptCountRef.current += 1;
          isPollingRef.current = false;
          if (attemptCountRef.current < maxAttempts) {
            timerRef.current = setTimeout(() => pollBatchStatus(batchId), pollIntervalMs);
          }
          return;
        }

        const currentStatus = data.status;

        if (currentStatus === 'processing' || currentStatus === 'pending' || currentStatus === 'queued') {
          attemptCountRef.current += 1;

          // Keep active upload registered to immunize session from idle timeout
          registerActiveUpload(batchId);
          setBatchResult(data);

          if (attemptCountRef.current >= maxAttempts) {
            isPollingRef.current = false;
            setIsTimedOut(true);
            setUiState(currentStatus === 'queued' ? 'queued' : 'processing');
            return;
          }

          setUiState(currentStatus === 'queued' ? 'queued' : 'processing');
          isPollingRef.current = false;
          timerRef.current = setTimeout(() => pollBatchStatus(batchId), pollIntervalMs);
          return;
        }

        if (
          currentStatus === 'completed' ||
          currentStatus === 'completed_with_errors' ||
          currentStatus === 'failed'
        ) {
          // Final status reached! Unregister active upload immunity
          unregisterActiveUpload(batchId);
          currentBatchIdRef.current = null;
          isPollingRef.current = false;
          setIsTimedOut(false);
          setBatchResult(data);
          setUiState(currentStatus);

          if (storageKey && typeof window !== 'undefined') {
            sessionStorage.removeItem(storageKey);
          }

          if (onCompleted) {
            onCompleted(data);
          }
          return;
        }

        // Unknown status fallback
        attemptCountRef.current += 1;
        isPollingRef.current = false;
        timerRef.current = setTimeout(() => pollBatchStatus(batchId), pollIntervalMs);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          isPollingRef.current = false;
          return;
        }

        console.warn('[useBatchPolling] Network error during batch status poll:', err);
        consecutiveNetworkErrorsRef.current += 1;
        isPollingRef.current = false;

        if (consecutiveNetworkErrorsRef.current >= 5) {
          setPollingError('Network connection issue while checking batch status. Will retry...');
        }

        timerRef.current = setTimeout(
          () => pollBatchStatus(batchId),
          pollIntervalMs + Math.min(consecutiveNetworkErrorsRef.current * 1000, 5000)
        );
      }
    },
    [maxAttempts, pollIntervalMs, storageKey, onCompleted, onError, abortActiveRequest]
  );

  const startPolling = useCallback(
    (batchId: string) => {
      clearTimer();
      abortActiveRequest();
      isPollingRef.current = false;
      attemptCountRef.current = 0;
      consecutiveNetworkErrorsRef.current = 0;

      currentBatchIdRef.current = batchId;
      // Immunize active session from idle timeout during upload processing
      registerActiveUpload(batchId);

      setActiveBatchId(batchId);
      setUiState('processing');
      setIsTimedOut(false);
      setPollingError(null);
      setBatchResult(null);

      if (storageKey && typeof window !== 'undefined') {
        sessionStorage.setItem(storageKey, batchId);
      }

      pollBatchStatus(batchId);
    },
    [clearTimer, abortActiveRequest, storageKey, pollBatchStatus]
  );

  const checkStatusNow = useCallback(() => {
    if (activeBatchId) {
      clearTimer();
      isPollingRef.current = false;
      setIsTimedOut(false);
      attemptCountRef.current = 0;
      pollBatchStatus(activeBatchId);
    }
  }, [activeBatchId, clearTimer, pollBatchStatus]);

  // Hook into centralized logout cancellation
  useEffect(() => {
    const unregister = registerCancellationCallback(() => {
      clearTimer();
      abortActiveRequest();
      if (currentBatchIdRef.current) {
        unregisterActiveUpload(currentBatchIdRef.current);
        currentBatchIdRef.current = null;
      }
      isPollingRef.current = false;
    });

    return () => {
      unregister();
    };
  }, [clearTimer, abortActiveRequest]);

  // Page refresh recovery & unmount cleanup
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && saved.trim()) {
        console.log(`[useBatchPolling] Recovering active batch "${saved}" after page reload.`);
        startPolling(saved.trim());
      }
    }

    return () => {
      clearTimer();
      abortActiveRequest();
      if (currentBatchIdRef.current) {
        unregisterActiveUpload(currentBatchIdRef.current);
        currentBatchIdRef.current = null;
      }
    };
  }, [storageKey, startPolling, clearTimer, abortActiveRequest]);

  return {
    uiState,
    setUiState,
    activeBatchId,
    batchResult,
    setBatchResult,
    pollingError,
    setPollingError,
    isTimedOut,
    startPolling,
    checkStatusNow,
    resetPolling,
    isProcessing: uiState === 'initiating' || uiState === 'processing',
  };
}
