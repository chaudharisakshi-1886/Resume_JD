-- Table: upload_queue
-- Description: Stores incoming candidate resumes and job descriptions queued for background processing.

CREATE TABLE IF NOT EXISTS upload_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  position_id TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('candidate', 'job')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_upload_queue_status ON upload_queue(status);
CREATE INDEX IF NOT EXISTS idx_upload_queue_batch_id ON upload_queue(batch_id);
CREATE INDEX IF NOT EXISTS idx_upload_queue_user_id ON upload_queue(user_id);

