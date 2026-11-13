-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('ADMIN', 'RECRUITER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('PROCESSING', 'FAILED', 'ACTIVE', 'INACTIVE', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AssessmentStatus" AS ENUM ('INVITED', 'SHORTLISTED', 'SCHEDULED', 'STARTED', 'COMPLETED', 'EVALUATED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. User Table
CREATE TABLE IF NOT EXISTS "User" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  role "Role" NOT NULL DEFAULT 'RECRUITER',
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Job Descriptions Table
CREATE TABLE IF NOT EXISTS job_descriptions (
  id BIGINT PRIMARY KEY,
  content_hash VARCHAR(255),
  job_code VARCHAR(255),
  job_title VARCHAR(255),
  jd_text TEXT,
  embedding JSONB,
  must_have_skills JSONB,
  good_to_have_skills JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'ACTIVE',
  skills JSONB,
  experience TEXT,
  seniority TEXT,
  topics JSONB,
  weights JSONB,
  mcqs JSONB,
  mcq_count INTEGER DEFAULT 0,
  error_message VARCHAR(255),
  department TEXT DEFAULT 'General',
  location TEXT DEFAULT 'Remote',
  "createdBy" TEXT REFERENCES "User"(id) ON DELETE CASCADE
);

-- 4. Candidate1 Table
CREATE TABLE IF NOT EXISTS candidate1 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id VARCHAR,
  candidate_fname VARCHAR(100),
  candidate_lname VARCHAR(100),
  candidate_email VARCHAR(255),
  phone VARCHAR,
  current_job_title VARCHAR,
  current_company VARCHAR,
  years_of_experience NUMERIC,
  seniority VARCHAR,
  skills JSONB,
  primary_skills JSONB,
  secondary_skills JSONB,
  skill_details JSONB,
  employment_history JSONB,
  projects JSONB,
  education JSONB,
  degree VARCHAR,
  field_of_study VARCHAR,
  institution VARCHAR,
  graduation_year INTEGER,
  certifications JSONB,
  languages JSONB,
  candidate_address TEXT,
  candidate_location VARCHAR,
  linkedin_url TEXT,
  github_url TEXT,
  portfolio_url TEXT,
  summary TEXT,
  topics JSONB,
  resume_text TEXT,
  source TEXT,
  upload_batch_id VARCHAR,
  parse_status BOOLEAN DEFAULT true,
  parsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  embedding JSONB,
  assessment_status "AssessmentStatus" DEFAULT 'INVITED',
  assessment_token VARCHAR UNIQUE,
  position_id BIGINT REFERENCES job_descriptions(id) ON DELETE SET NULL,
  invite_sent_at TIMESTAMPTZ DEFAULT NOW(),
  resume_url VARCHAR,
  status VARCHAR DEFAULT 'Active',
  inactive_at TIMESTAMPTZ,
  user_id TEXT
);

-- 5. Assessment Table
CREATE TABLE IF NOT EXISTS "Assessment" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "candidateId" UUID UNIQUE NOT NULL REFERENCES candidate1(id) ON DELETE CASCADE,
  job_id BIGINT,
  questions JSONB NOT NULL,
  "assignedQuestionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  answers JSONB,
  score DOUBLE PRECISION,
  percentage DOUBLE PRECISION,
  "evaluationData" JSONB,
  "completedAt" TIMESTAMP
);

-- 6. QuestionBank Table
CREATE TABLE IF NOT EXISTS "QuestionBank" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  position_id BIGINT NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  topic TEXT NOT NULL,
  options JSONB,
  answer TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 7. Slot Table
CREATE TABLE IF NOT EXISTS "Slot" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "startTime" TIMESTAMP NOT NULL,
  "endTime" TIMESTAMP NOT NULL,
  capacity INTEGER NOT NULL,
  "bookedCount" INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 8. SlotBooking Table
CREATE TABLE IF NOT EXISTS "SlotBooking" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "candidateId" UUID UNIQUE NOT NULL REFERENCES candidate1(id) ON DELETE CASCADE,
  "slotId" TEXT NOT NULL REFERENCES "Slot"(id) ON DELETE CASCADE,
  "reminderSent" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 9. Upload Batches Table
CREATE TABLE IF NOT EXISTS upload_batches (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) DEFAULT 'system',
  batch_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'processing',
  total_received INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  inserted_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  duplicate_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upload_batches_user_id ON upload_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_batches_status ON upload_batches(status);
CREATE INDEX IF NOT EXISTS idx_upload_batches_created_at ON upload_batches(created_at DESC);

-- 10. Output1 Table
CREATE TABLE IF NOT EXISTS output1 (
  id BIGSERIAL PRIMARY KEY,
  resume_id VARCHAR,
  candidate_id VARCHAR,
  candidate_name VARCHAR,
  candidate_email VARCHAR,
  job_code VARCHAR,
  job_title VARCHAR,
  match_percent NUMERIC,
  band VARCHAR,
  coverage_matched INTEGER,
  coverage_total INTEGER,
  coverage_percent NUMERIC,
  dimension_scores JSONB,
  dimension_contributions JSONB,
  matched_skills JSONB,
  gap_skills JSONB,
  knockout_status VARCHAR,
  knockout_flags JSONB,
  data_confidence NUMERIC,
  recommended_next_step TEXT,
  explanation JSONB,
  score_skills NUMERIC,
  score_experience NUMERIC,
  score_responsibilities NUMERIC,
  score_domain NUMERIC,
  score_seniority NUMERIC,
  score_education NUMERIC,
  coverage_text TEXT,
  job_seniority VARCHAR,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

-- 11. Upload Queue Table
CREATE TABLE IF NOT EXISTS upload_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  position_id TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('candidate','job')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_upload_queue_status ON upload_queue(status);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_candidate1_user_id ON candidate1(user_id);
CREATE INDEX IF NOT EXISTS idx_candidate1_position_id ON candidate1(position_id);
CREATE INDEX IF NOT EXISTS idx_candidate1_email ON candidate1(candidate_email);
CREATE INDEX IF NOT EXISTS idx_job_descriptions_created_by ON job_descriptions("createdBy");
CREATE INDEX IF NOT EXISTS idx_job_descriptions_job_code ON job_descriptions(job_code);

