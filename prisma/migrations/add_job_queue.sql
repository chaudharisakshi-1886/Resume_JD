-- Migration: add_job_queue
-- Creates the job_queue table used by the queued upload mode for job descriptions.
-- One row per JD file. Multiple files in one upload share the same batch_id.
-- Status lifecycle: incoming -> processing -> done | failed

CREATE TABLE IF NOT EXISTS job_queue (
  id            BIGSERIAL    PRIMARY KEY,
  batch_id      TEXT         NOT NULL,
  user_id       TEXT         NOT NULL,
  file_name     TEXT         NOT NULL,
  file_type     TEXT         NOT NULL DEFAULT 'application/pdf',
  job_text      TEXT         NOT NULL,
  position_id   TEXT,
  callback_url  TEXT         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'incoming',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status);
CREATE INDEX IF NOT EXISTS idx_job_queue_batch  ON job_queue(batch_id);

