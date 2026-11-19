'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Briefcase, Calendar, MapPin, Tag, Loader2, FileText, CheckCircle, ShieldAlert, Award } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';

import { Question, Candidate, Job } from '@/types';

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [job, setJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'questions'>('details');

  const fetchJobDetails = React.useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) throw new Error('Failed to fetch job details');
      const data = await res.json();
      if (data.job) {
        setJob(data.job);
      } else {
        throw new Error('Job not found');
      }
    } catch (err: any) {
      setError(err.message || 'Error loading job details');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchJobDetails();
  }, [fetchJobDetails]);

  if (isLoading) {
    return (
      <div className="py-32 flex flex-col items-center justify-center space-y-4 max-w-5xl mx-auto">
        <Loader2 className="h-10 w-10 text-indigo-600 animate-spin" />
        <span className="text-sm font-medium text-neutral-500">Loading job analysis...</span>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="py-24 text-center bg-white border border-neutral-200 rounded-2xl shadow-xs max-w-xl mx-auto px-6 space-y-4">
        <div className="p-3 bg-red-50 text-red-500 rounded-full inline-block">
          <ShieldAlert className="h-10 w-10" />
        </div>
        <h3 className="text-lg font-bold text-neutral-900">Failed to Load Job</h3>
        <p className="text-sm text-neutral-500">{error || 'The job record could not be retrieved.'}</p>
        <Link href="/dashboard/jobs">
          <Button variant="outline" size="sm" className="mt-4">
            Back to Jobs
          </Button>
        </Link>
      </div>
    );
  }

  const parsedJDData = React.useMemo(() => {
    const raw = job?.parsedJDData || {};
    const toArr = (val: any): string[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(String);
      if (typeof val === 'string') {
        try {
          const p = JSON.parse(val);
          if (Array.isArray(p)) return p.map(String);
          if (p) return [String(p)];
        } catch {
          return val.trim() ? [val.trim()] : [];
        }
      }
      return [];
    };

    const toObj = (val: any): Record<string, number> => {
      if (!val) return {};
      if (typeof val === 'object' && !Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const p = JSON.parse(val);
          if (typeof p === 'object' && p !== null && !Array.isArray(p)) return p;
        } catch {
          return {};
        }
      }
      return {};
    };

    return {
      seniority: raw.seniority || '',
      experience: raw.experience || '',
      weights: toObj(raw.weights),
      mustHave: toArr(raw.mustHave),
      goodToHave: toArr(raw.goodToHave),
      topics: toArr(raw.topics),
    };
  }, [job]);

  const questions = job.questions || [];

  const columns = [
    {
      header: 'Topic',
      accessorKey: 'topic',
      sortable: true,
      cell: (q: Question) => (
        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 uppercase tracking-wider text-[10px] font-bold">
          {q.topic}
        </span>
      ),
    },
    {
      header: 'Question & Multiple-Choice Options',
      accessorKey: 'question',
      sortable: true,
      cell: (q: Question) => (
        <div className="space-y-3 py-1.5 max-w-2xl">
          <div className="text-sm font-bold text-neutral-950 leading-relaxed">{q.question}</div>
          {q.options && Array.isArray(q.options) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-neutral-600 font-medium font-sans">
              {q.options.map((opt, oIdx) => {
                const labels = ['A', 'B', 'C', 'D'];
                const isCorrect = opt === q.answer;
                return (
                  <div
                    key={oIdx}
                    className={`flex items-center gap-2 border px-3 py-1.5 rounded-lg transition-colors ${isCorrect
                        ? 'bg-emerald-50/40 border-emerald-200/80 text-emerald-905 font-bold shadow-2xs'
                        : 'bg-neutral-50/50 border-neutral-200 text-neutral-700'
                      }`}
                  >
                    <span className={`h-5 w-5 font-extrabold flex items-center justify-center rounded-full text-[10px] shrink-0 ${isCorrect ? 'bg-emerald-600 text-white shadow-xs' : 'bg-neutral-200 text-neutral-500'
                      }`}>
                      {labels[oIdx] || oIdx + 1}
                    </span>
                    <span className="truncate">{opt}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ),
    },
    {
      header: 'Correct Option Answer',
      accessorKey: 'answer',
      sortable: true,
      cell: (q: Question) => {
        const labels = ['A', 'B', 'C', 'D'];
        const options = q.options || [];
        const optIndex = options.indexOf(q.answer);
        const correctLabel = optIndex !== -1 ? labels[optIndex] : 'A';
        return (
          <span className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 shadow-2xs">
            <span className="h-5 w-5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">
              {correctLabel}
            </span>
            <span className="truncate max-w-[150px]" title={q.answer}>
              {q.answer}
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto px-4 py-8">
      {/* Back Link */}
      <div>
        <Link
          href="/dashboard/jobs"
          className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 transition-colors group"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          <span className="font-medium">Back to Jobs</span>
        </Link>
      </div>

      {/* Profile Overview Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6 relative overflow-hidden">
        <div className="absolute right-0 top-0 h-32 w-32 bg-indigo-50/30 rounded-full blur-3xl -z-10" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 bg-indigo-600 text-white font-extrabold flex items-center justify-center rounded-xl shadow-sm">
              <Briefcase className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold text-neutral-900">{job.title}</h2>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-full border ${job.status === 'ACTIVE'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : job.status === 'PROCESSING'
                        ? 'bg-amber-50 border-amber-200 text-amber-800 animate-pulse'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                    }`}
                >
                  {job.status}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-neutral-500 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Tag className="h-4 w-4 text-neutral-400" />
                  {job.department}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-neutral-400" />
                  {job.location}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-neutral-400" />
                  {new Date(job.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Selector */}
      <div className="flex border-b border-neutral-200">
        <button
          onClick={() => setActiveTab('details')}
          className={`py-3 px-6 text-sm font-semibold border-b-2 transition-all cursor-pointer ${activeTab === 'details'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
        >
          JD Analysis Details
        </button>
        <button
          onClick={() => setActiveTab('questions')}
          className={`py-3 px-6 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${activeTab === 'questions'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
        >
          <span>Assessment Pool</span>
          <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-indigo-50 text-indigo-700">
            {questions.length}
          </span>
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'details' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Core weights & details */}
          <div className="space-y-6 lg:col-span-1">
            {/* Seniority Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6 space-y-4">
              <h4 className="text-xs uppercase font-extrabold tracking-wider text-neutral-500">Core Attributes</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block">Seniority</span>
                  <span className="text-sm font-bold text-neutral-800">{parsedJDData?.seniority || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-neutral-400 block">Experience</span>
                  <span className="text-sm font-bold text-neutral-800">{parsedJDData?.experience || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Weights Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 overflow-hidden">
              <div className="px-6 py-4 border-b border-neutral-100 bg-neutral-50/50">
                <h4 className="text-xs uppercase font-extrabold tracking-wider text-neutral-500">Evaluation Weights</h4>
              </div>
              <div className="p-6 space-y-4">
                {parsedJDData?.weights && Object.keys(parsedJDData.weights).length > 0 ? (
                  Object.entries(parsedJDData.weights).map(([skill, val]) => (
                    <div key={skill} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-neutral-700">{skill}</span>
                        <span className="text-indigo-600 font-extrabold">{val as number}%</span>
                      </div>
                      <div className="h-2 w-full bg-neutral-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full"
                          style={{ width: `${val}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-neutral-400">Weights not generated yet.</p>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Must/Good to have & topics */}
          <div className="lg:col-span-2 space-y-6">
            {/* Must Have Requirements */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 overflow-hidden">
              <div className="px-6 py-4 bg-neutral-50/50 border-b border-neutral-100 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-indigo-600" />
                <h4 className="text-xs uppercase font-extrabold tracking-wider text-neutral-500 font-semibold">Must-Have Requirements</h4>
              </div>
              <div className="p-6">
                <ul className="list-disc pl-5 space-y-2 text-sm text-neutral-700">
                  {Array.isArray(parsedJDData?.mustHave) && parsedJDData.mustHave.length > 0 ? (
                    parsedJDData.mustHave.map((item, idx) => (
                      <li key={idx} className="leading-relaxed">{item}</li>
                    ))
                  ) : (
                    <li className="text-neutral-400 list-none pl-0">Not specified.</li>
                  )}
                </ul>
              </div>
            </div>

            {/* Good to Have */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 overflow-hidden">
              <div className="px-6 py-4 bg-neutral-50/50 border-b border-neutral-100 flex items-center gap-2">
                <Award className="h-5 w-5 text-indigo-600" />
                <h4 className="text-xs uppercase font-extrabold tracking-wider text-neutral-500">Good-to-Have Skills</h4>
              </div>
              <div className="p-6">
                <ul className="list-disc pl-5 space-y-2 text-sm text-neutral-700">
                  {Array.isArray(parsedJDData?.goodToHave) && parsedJDData.goodToHave.length > 0 ? (
                    parsedJDData.goodToHave.map((item, idx) => (
                      <li key={idx} className="leading-relaxed">{item}</li>
                    ))
                  ) : (
                    <li className="text-neutral-400 list-none pl-0">Not specified.</li>
                  )}
                </ul>
              </div>
            </div>

            {/* Assessment Topics */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 overflow-hidden">
              <div className="px-6 py-4 bg-neutral-50/50 border-b border-neutral-100 flex items-center gap-2">
                <FileText className="h-5 w-5 text-indigo-600" />
                <h4 className="text-xs uppercase font-extrabold tracking-wider text-neutral-500">Primary Topics Evaluated</h4>
              </div>
              <div className="p-6">
                <div className="flex flex-wrap gap-2">
                  {Array.isArray(parsedJDData?.topics) && parsedJDData.topics.length > 0 ? (
                    parsedJDData.topics.map((topic, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 bg-indigo-50 border border-indigo-100 text-indigo-800 font-bold rounded-full text-xs"
                      >
                        {topic}
                      </span>
                    ))
                  ) : (
                    <span className="text-neutral-400 text-sm">Not specified.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Questions tab content */
        <div className="space-y-6">
          {/* Question table listing MCQ options using premium DataTable */}
          {job.status === 'PROCESSING' && questions.length === 0 ? (
            <div className="py-20 bg-white border-2 border-dashed border-neutral-200 rounded-2xl text-center space-y-4 max-w-xl mx-auto px-6">
              <Loader2 className="h-10 w-10 text-amber-500 animate-spin mx-auto" />
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-neutral-900">AI Analysis & Generation In Progress</h3>
                <p className="text-sm text-neutral-500">
                  Our LLM engine is evaluating the Job Description to compile high-quality evaluation questions and expected answers. This usually takes under 30 seconds.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6">
              <DataTable
                columns={columns}
                data={questions}
                searchKey="question"
                searchPlaceholder="Search questions or topics..."
                itemsPerPage={10}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
