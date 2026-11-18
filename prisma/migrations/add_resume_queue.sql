-- Migration: add_resume_queue
-- Creates the resume_queue table used by the queued upload mode.
-- One row per resume file. Multiple files in one upload share the same batch_id.
-- Status lifecycle: incoming -> processing -> done | failed

CREATE TABLE IF NOT EXISTS resume_queue (
  id            BIGSERIAL    PRIMARY KEY,
  batch_id      TEXT         NOT NULL,
  user_id       TEXT         NOT NULL,
  file_name     TEXT         NOT NULL,
  file_type     TEXT         NOT NULL DEFAULT 'application/pdf',
  resume_text   TEXT         NOT NULL,
  callback_url  TEXT         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'incoming',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_resume_queue_status ON resume_queue(status);
CREATE INDEX IF NOT EXISTS idx_resume_queue_batch  ON resume_queue(batch_id);
