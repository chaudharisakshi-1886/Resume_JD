export interface Question {
  id: string;
  question: string;
  topic: string;
  options?: any;
  answer?: string;
}

export interface Assessment {
  id?: string;
  score: number | null;
  percentage: number | null;
  evaluationData: any;
  questions?: any;
  answers?: any;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  phone?: string;
  assessmentStatus?: string;
  assessments: Assessment[];
  job: {
    id: string;
    title: string;
  };
}

export interface JobMinimal {
  id: string;
  title: string;
  status?: string;
}

export interface CandidateItem {
  id: string;
  candidateId?: string | null;
  name: string;
  email: string;
  phone: string | null;
  jobId: string;
  assessmentStatus: 'INVITED' | 'STARTED' | 'COMPLETED' | 'EVALUATED' | 'SHORTLISTED' | 'SCHEDULED' | 'EXPIRED';
  assessmentToken: string;
  inviteSentAt: string;
  yearsOfExperience?: number | string | null;
  currentJobTitle?: string | null;
  currentCompany?: string | null;
  skills?: string[] | any;
  summary?: string | null;
  resumeText?: string | null;
  resumeUrl?: string | null;
  job?: {
    title: string;
  };
  assessments: {
    score: number | null;
  }[];
  createdAt?: string;
  status?: string;
  inactiveAt?: string | null;
}

export interface Job {
  id: string;
  title: string;
  department: string;
  location: string;
  experience: string;
  status: string;
  createdAt: string;
  parsedJDData: {
    seniority?: string;
    experience?: string;
    topics?: string[];
    mustHave?: string[];
    goodToHave?: string[];
    weights?: Record<string, number>;
  };
  questions: Question[];
  candidates: Candidate[];
}

export interface TimeSlot {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  type: string; // 'Technical Interview' | 'System Design' | 'HR Screening'
  status: 'AVAILABLE' | 'BOOKED' | 'BLOCKED';
  candidateName?: string;
  candidateEmail?: string;
}

export interface JobItem {
  id: string;
  title: string;
  department: string;
  location: string;
  experience: string;
  status: 'ACTIVE' | 'INACTIVE' | 'CLOSED';
  createdAt: string;
  parsedJDData: any;
  _count: {
    candidates: number;
    questions: number;
  };
}

export interface MatchedCandidate {
  id?: string;
  resumeId?: string;
  resume_id?: string;
  candidateId?: string;
  candidate_id?: string;
  jobCode: string;
  job_code?: string;
  jobTitle?: string;
  job_title?: string;
  jobSeniority?: string | null;
  job_seniority?: string | null;
  candidateName: string;
  candidate_name?: string;
  candidateEmail: string;
  candidate_email?: string;
  score: number;
  match_percent?: number;
  matchStatus: string;
  band?: string | null;
  coverage_matched?: number | null;
  coverage_total?: number | null;
  coverage_percent?: number | null;
  coverage_text?: string | null;
  score_skills?: number | string | null;
  score_experience?: number | string | null;
  score_responsibilities?: number | string | null;
  score_domain?: number | string | null;
  score_seniority?: number | string | null;
  score_education?: number | string | null;
  dimension_scores?: any;
  dimension_contributions?: any;
  matched_skills?: string[] | string | null;
  gap_skills?: string[] | string | null;
  knockout_status?: string | null;
  knockout_flags?: string[] | string | null;
  data_confidence?: number | null;
  recommended_next_step?: string | null;
  explanation?: any;
  createdAt: string;
  created_at?: string;

  // Joined from candidates:
  phone?: string | null;
  current_job_title?: string | null;
  current_company?: string | null;
  years_of_experience?: number | string | null;
  seniority?: string | null;
  candidate_seniority?: string | null;
  location?: string | null;
}

export interface JobDescriptionItem {
  contentHash: string;
  jobCode: string;
  jobTitle: string;
  jdText: string;
  createdAt: string;
  status?: string;
  inactiveAt?: string | null;
  candidatesCount: number;
  matchedCandidates?: MatchedCandidate[];
}

export interface UploadRecordDetail {
  file_name?: string;
  job_code?: string;
  job_title?: string;
  candidate_id?: string;
  candidate_name?: string;
  candidate_email?: string;
  reason?: string;
  error?: string;
  text?: string;
  file_type?: string;
  wordCount?: number;
  charCount?: number;
  status?: 'inserted' | 'duplicate' | 'failed';
  [key: string]: any;
}

export type BatchStatus = 'queued' | 'pending' | 'processing' | 'completed' | 'completed_with_errors' | 'failed';

export interface UploadBatchResponse {
  batch_id?: string;
  status?: BatchStatus;
  success?: boolean;
  message: string;
  total_received: number;
  inserted_count: number;
  duplicate_count: number;
  failed_count: number;
  inserted_records: UploadRecordDetail[];
  duplicate_records: UploadRecordDetail[];
  failed_records: UploadRecordDetail[];
  inserted_candidates?: UploadRecordDetail[];
  duplicate_candidates?: UploadRecordDetail[];
  failed_candidates?: UploadRecordDetail[];
  inserted_job_descriptions?: UploadRecordDetail[];
  duplicate_job_descriptions?: UploadRecordDetail[];
  failed_job_descriptions?: UploadRecordDetail[];
  unknown_outcome?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface UploadBatchStatusResponse extends UploadBatchResponse {
  batch_id: string;
  status: BatchStatus;
}

