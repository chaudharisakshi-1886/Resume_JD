'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { DataTable, ColumnDef } from '@/components/ui/data-table';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { 
  Briefcase, 
  Eye, 
  Trash2, 
  Plus, 
  Calendar, 
  Upload, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw,
  FileText,
  Users,
  Copy,
  Check,
  Sparkles,
  Search,
  ExternalLink,
  Layers,
  Database
} from 'lucide-react';

import { JobItem, JobDescriptionItem, MatchedCandidate } from '@/types';
import { CandidateScorecardModal } from '@/components/dashboard/candidate-scorecard-modal';

export default function JobsPage() {
  const [activeTab, setActiveTab] = React.useState<'descriptions' | 'assessmentJobs'>('descriptions');
  
  // Job Descriptions (Supabase job_descriptions table)
  const [jobDescriptions, setJobDescriptions] = React.useState<JobDescriptionItem[]>([]);
  const [totalMatchedCandidates, setTotalMatchedCandidates] = React.useState<number>(0);
  const [isLoadingDescriptions, setIsLoadingDescriptions] = React.useState(true);
  
  // Assessment Jobs (jobs table)
  const [jobs, setJobs] = React.useState<JobItem[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = React.useState(true);

  // User role and administrative scope toggle ('mine' = strictly caller's uploads, 'all' = team-wide)
  const [currentUser, setCurrentUser] = React.useState<any>(null);
  const [adminScope, setAdminScope] = React.useState<'mine' | 'all'>('mine');

  // Status Filter for JDs
  const [jdStatusFilter, setJdStatusFilter] = React.useState('All');

  // Selected JD for detail view modal
  const [selectedJD, setSelectedJD] = React.useState<JobDescriptionItem | null>(null);
  const [selectedCandidateJob, setSelectedCandidateJob] = React.useState<JobDescriptionItem | null>(null);
  const [selectedScorecardCandidate, setSelectedScorecardCandidate] = React.useState<MatchedCandidate | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Fetch Supabase job_descriptions
  const fetchJobDescriptions = async (scope = adminScope) => {
    try {
      setIsLoadingDescriptions(true);
      const query = scope === 'all' ? '?scope=all' : '';
      const res = await fetch(`/api/jobs/descriptions${query}`);
      if (!res.ok) {
        console.warn(`Failed to fetch job descriptions (status: ${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.jobDescriptions) {
        setJobDescriptions(data.jobDescriptions);
      }
      if (typeof data.totalMatchedCandidates === 'number') {
        setTotalMatchedCandidates(data.totalMatchedCandidates);
      }
    } catch (error) {
      console.error('Error fetching job_descriptions:', error);
    } finally {
      setIsLoadingDescriptions(false);
    }
  };

  // Fetch assessment jobs
  const fetchJobs = async (scope = adminScope) => {
    try {
      setIsLoadingJobs(true);
      const query = scope === 'all' ? '?scope=all' : '';
      const res = await fetch(`/api/jobs${query}`);
      if (!res.ok) {
        console.warn(`Failed to fetch assessment jobs (status: ${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.jobs) {
        setJobs(data.jobs);
      }
    } catch (error) {
      console.error('Error fetching assessment jobs:', error);
    } finally {
      setIsLoadingJobs(false);
    }
  };

  const hasFetched = React.useRef(false);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('auth_user');
      if (stored) {
        setCurrentUser(JSON.parse(stored));
      }
    } catch {}

    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchJobDescriptions('mine');
    fetchJobs('mine');
  }, []);

  const handleCopyJD = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle status toggle for assessment jobs
  const handleStatusChange = async (jobId: string, currentStatus: string) => {
    const nextStatusMap: Record<string, 'ACTIVE' | 'INACTIVE' | 'CLOSED'> = {
      ACTIVE: 'INACTIVE',
      INACTIVE: 'CLOSED',
      CLOSED: 'ACTIVE',
    };
    const nextStatus = nextStatusMap[currentStatus] || 'ACTIVE';

    try {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: nextStatus } : j))
      );

      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) fetchJobs();
    } catch (error) {
      console.error('Error updating job status:', error);
      fetchJobs();
    }
  };

  // Handle status toggle for job descriptions
  const handleJDStatusChange = async (jd: JobDescriptionItem) => {
    const nextStatus = jd.status === 'Active' ? 'Inactive' : 'Active';
    try {
      setJobDescriptions((prev) =>
        prev.map((j) => (j.contentHash === jd.contentHash ? { ...j, status: nextStatus } : j))
      );
      const res = await fetch('/api/jobs/descriptions/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentHash: jd.contentHash, status: nextStatus }),
      });
      if (!res.ok) fetchJobDescriptions();
    } catch (error) {
      console.error('Error updating JD status:', error);
      fetchJobDescriptions();
    }
  };

  // Handle delete for assessment jobs
  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this job position? All candidate records associated with it will be removed.')) {
      return;
    }

    try {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'DELETE',
      });
      if (!res.ok) fetchJobs();
    } catch (error) {
      console.error('Error deleting job:', error);
      fetchJobs();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'INACTIVE':
        return 'bg-neutral-100 text-neutral-600 border-neutral-200';
      case 'CLOSED':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-neutral-100 text-neutral-800';
    }
  };

  // Columns for Supabase Job Descriptions table
  const jobDescriptionColumns: ColumnDef<JobDescriptionItem>[] = [
    {
      header: 'Job Code',
      accessorKey: 'jobCode',
      sortable: true,
      cell: (jd: JobDescriptionItem) => (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs">
            {jd.jobCode || 'N/A'}
          </span>
        </div>
      ),
    },
    {
      header: 'Job Title',
      accessorKey: 'jobTitle',
      sortable: true,
      cell: (jd: JobDescriptionItem) => (
        <div className="max-w-[220px]">
          <div className="text-xs font-bold text-neutral-900 truncate" title={jd.jobTitle}>
            {jd.jobTitle || 'Untitled Role'}
          </div>
          <div className="text-[10px] text-neutral-500 font-mono truncate">
            hash: {jd.contentHash ? `${jd.contentHash.substring(0, 8)}...` : 'N/A'}
          </div>
        </div>
      ),
    },
    {
      header: 'Job Description',
      accessorKey: 'jdText',
      cell: (jd: JobDescriptionItem) => (
        <div className="max-w-md">
          <p className="text-xs text-neutral-600 line-clamp-2 leading-relaxed">
            {jd.jdText || 'No description text provided.'}
          </p>
          {jd.jdText && (
            <button
              type="button"
              onClick={() => setSelectedJD(jd)}
              className="mt-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <FileText className="h-3 w-3" />
              Read Full Description
            </button>
          )}
        </div>
      ),
    },
    {
      header: 'Candidates',
      accessorKey: 'candidatesCount',
      sortable: true,
      cell: (jd: JobDescriptionItem) => (
        <div>
          <button
            type="button"
            onClick={() => setSelectedCandidateJob(jd)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-colors cursor-pointer ${
              jd.candidatesCount > 0
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                : 'bg-neutral-100 text-neutral-500 border border-neutral-200'
            }`}
          >
            <Users className="h-3 w-3" />
            <span>{jd.candidatesCount}</span>
            <span className="text-[10px] font-normal text-neutral-400">matched</span>
          </button>
        </div>
      ),
    },
    {
      header: 'Posted Date',
      accessorKey: 'createdAt',
      sortable: true,
      cell: (jd: JobDescriptionItem) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
          <Calendar className="h-3.5 w-3.5 text-neutral-400" />
          {new Date(jd.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      sortable: true,
      cell: (jd: JobDescriptionItem) => {
        const isActive = jd.status !== 'Inactive';
        return (
          <button
            onClick={() => handleJDStatusChange(jd)}
            className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-sm border cursor-pointer select-none transition-all hover:brightness-95 uppercase ${
              isActive
                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                : 'bg-neutral-100 text-neutral-600 border-neutral-200'
            }`}
            title="Click to toggle status"
          >
            {isActive ? 'ACTIVE' : 'INACTIVE'}
          </button>
        );
      },
    },
    {
      header: 'Actions',
      cell: (jd: JobDescriptionItem) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0 cursor-pointer text-indigo-600 hover:bg-indigo-50 border-neutral-200"
            onClick={() => setSelectedJD(jd)}
            title="View Full Job Description"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0 cursor-pointer text-neutral-600 hover:bg-neutral-50 border-neutral-200"
            onClick={() => handleCopyJD(jd.jdText)}
            title="Copy JD text"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  // Columns for Assessment Jobs table (jobs table)
  const assessmentJobColumns: ColumnDef<JobItem>[] = [
    {
      header: 'Job Opening',
      accessorKey: 'title',
      sortable: true,
      cell: (job: JobItem) => (
        <div>
          <div className="text-xs font-semibold text-neutral-900">{job.title}</div>
          <div className="text-[10px] text-neutral-500 font-medium">
            {job.department} &bull; {job.location}
          </div>
        </div>
      ),
    },
    {
      header: 'Experience',
      accessorKey: 'experience',
      sortable: true,
    },
    {
      header: 'Questions Pool',
      accessorKey: '_count.questions',
      sortable: true,
      cell: (job: JobItem) => (
        <span className="inline-flex items-center gap-1 font-semibold text-neutral-900 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md text-[11px] text-indigo-700">
          {job._count.questions || 0} MCQs
        </span>
      ),
    },
    {
      header: 'Candidates',
      accessorKey: '_count.candidates',
      sortable: true,
      cell: (job: JobItem) => (
        <span className="text-xs font-bold text-neutral-900">
          {job._count.candidates}
        </span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      sortable: true,
      cell: (job: JobItem) => (
        <button
          onClick={() => handleStatusChange(job.id, job.status)}
          className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-sm border cursor-pointer select-none transition-all hover:brightness-95 uppercase ${getStatusColor(
            job.status
          )}`}
          title="Click to cycle status"
        >
          {job.status}
        </button>
      ),
    },
    {
      header: 'Posted Date',
      accessorKey: 'createdAt',
      sortable: true,
      cell: (job: JobItem) => (
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5 text-neutral-400" />
          {new Date(job.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      ),
    },
    {
      header: 'Actions',
      cell: (job: JobItem) => (
        <div className="flex items-center justify-end gap-1.5">
          <Link href={`/dashboard/jobs/${job.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 cursor-pointer"
              title="View AI parsed details and questions"
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 cursor-pointer"
            onClick={() => handleDeleteJob(job.id)}
            title="Delete Job"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const totalCandidatesAcrossJDs = jobDescriptions.reduce((sum, j) => sum + (j.candidatesCount || 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <PageHeader
        title="Job Openings"
        description="Manage job openings, candidate matches, and assessment models."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            fetchJobDescriptions();
            fetchJobs();
          }}
          className="cursor-pointer gap-1.5 border-neutral-200"
          title="Refresh database records"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Sync</span>
        </Button>
        <Link href="/dashboard/jobs/upload">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer gap-1.5 border-neutral-200"
          >
            <Upload className="h-4 w-4" />
            <span>Upload Job Description</span>
          </Button>
        </Link>
        <Link href="/dashboard/jobs/new">
          <Button size="sm" className="cursor-pointer gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
            <Plus className="h-4 w-4" />
            <span>Post New Job</span>
          </Button>
        </Link>
      </PageHeader>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <MetricCard
          label="Job Descriptions"
          value={jobDescriptions.length}
          icon={FileText}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50/80 border-indigo-100"
        />
        <MetricCard
          label="Matched Candidates"
          value={totalMatchedCandidates > 0 ? totalMatchedCandidates : totalCandidatesAcrossJDs}
          icon={Users}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50/80 border-emerald-100"
        />
        <MetricCard
          label="Assessment Models"
          value={jobs.length}
          icon={Briefcase}
          iconColor="text-blue-600"
          iconBg="bg-blue-50/80 border-blue-100"
        />
        <MetricCard
          label="Latest JD Posted"
          value={
            jobDescriptions[0]
              ? new Date(jobDescriptions[0].createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'N/A'
          }
          subtext={jobDescriptions[0]?.jobCode ? `Code: ${jobDescriptions[0].jobCode}` : undefined}
          icon={Calendar}
          iconColor="text-neutral-500"
          iconBg="bg-neutral-50 border-neutral-200"
        />
      </div>

      {/* Tabs Switcher & Role-Based Scope Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-200 gap-3">
        <div className="flex">
          <button
            type="button"
            onClick={() => setActiveTab('descriptions')}
            className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === 'descriptions'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Job Descriptions</span>
            <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100">
              {jobDescriptions.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('assessmentJobs')}
            className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === 'assessmentJobs'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>Assessment Models</span>
            <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-neutral-100 text-neutral-600 font-semibold border border-neutral-200">
              {jobs.length}
            </span>
          </button>
        </div>

        {currentUser?.role === 'ADMIN' && (
          <div className="flex items-center gap-2 pb-2 self-start sm:self-auto">
            <span className="text-xs text-neutral-500 font-medium">Filter View:</span>
            <div className="inline-flex rounded-md p-0.5 bg-neutral-100 border border-neutral-200 text-xs">
              <button
                type="button"
                onClick={() => {
                  setAdminScope('mine');
                  fetchJobDescriptions('mine');
                  fetchJobs('mine');
                }}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                  adminScope === 'mine'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                My Uploads
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminScope('all');
                  fetchJobDescriptions('all');
                  fetchJobs('all');
                }}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                  adminScope === 'all'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                All Team Uploads
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tab 1 Content: Job Descriptions */}
      {activeTab === 'descriptions' && (
        <div>
          {isLoadingDescriptions ? (
            <div className="py-24 flex flex-col items-center justify-center space-y-3 bg-white border border-neutral-200 rounded-xl shadow-xs">
              <div className="h-6 w-6 border-2 border-indigo-600 border-t-transparent animate-spin rounded-full" />
              <span className="text-xs text-neutral-500">Loading job descriptions...</span>
            </div>
          ) : jobDescriptions.length === 0 ? (
            <div className="py-24 flex flex-col items-center justify-center text-center space-y-3 px-4 bg-white border border-neutral-200 rounded-xl shadow-xs">
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 text-neutral-400 inline-block w-fit mx-auto">
                <FileText className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-neutral-900">No Job Descriptions Found</h3>
                <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                  Upload a new job description to get started.
                </p>
              </div>
              <div className="mt-2">
                <Link href="/dashboard/jobs/upload">
                  <Button size="sm" className="cursor-pointer gap-1.5">
                    <Upload className="h-4 w-4" />
                    <span>Upload Job Description</span>
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <select
                  value={jdStatusFilter}
                  onChange={(e) => setJdStatusFilter(e.target.value)}
                  className="text-xs rounded-sm border border-neutral-200 bg-white px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 cursor-pointer"
                >
                  <option value="All">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <DataTable
                columns={jobDescriptionColumns}
                data={jobDescriptions.filter(
                  (jd) => jdStatusFilter === 'All' || (jd.status || 'Active') === jdStatusFilter
                )}
                searchPlaceholder="Search by job title, job code, or description..."
                searchKey="jobTitle"
                itemsPerPage={10}
              />
            </div>
          )}
        </div>
      )}

      {/* Tab 2 Content: Assessment Jobs */}
      {activeTab === 'assessmentJobs' && (
        <div>
          {isLoadingJobs ? (
            <div className="py-24 flex flex-col items-center justify-center space-y-3 bg-white border border-neutral-200 rounded-xl shadow-xs">
              <div className="h-6 w-6 border-2 border-neutral-900 border-t-transparent animate-spin rounded-full" />
              <span className="text-xs text-neutral-400">Loading job postings...</span>
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-24 flex flex-col items-center justify-center text-center space-y-3 px-4 bg-white border border-neutral-200 rounded-xl shadow-xs">
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 text-neutral-400 inline-block w-fit mx-auto">
                <Briefcase className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-neutral-900">No Assessment Jobs Posted</h3>
                <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                  Post a new job opening to begin generating assessment questions.
                </p>
              </div>
              <div className="mt-2">
                <Link href="/dashboard/jobs/new">
                  <Button size="sm" className="cursor-pointer">
                    Post First Job
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <DataTable
              columns={assessmentJobColumns}
              data={jobs}
              searchPlaceholder="Search assessment jobs..."
              searchKey="title"
              itemsPerPage={10}
            />
          )}
        </div>
      )}

      {/* Modal 1: Full Job Description Details */}
      {selectedJD && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/40 backdrop-blur-xs">
          <div className="relative z-50 w-full max-w-2xl border border-neutral-200 bg-white p-6 shadow-2xl rounded-2xl text-neutral-900 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {selectedJD.jobCode || 'JD'}
                  </span>
                  <h3 className="text-base font-bold text-neutral-900">{selectedJD.jobTitle}</h3>
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Posted on {new Date(selectedJD.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJD(null)}
                className="text-neutral-400 hover:text-neutral-600 transition-colors p-1 rounded-md hover:bg-neutral-100 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-neutral-50 rounded-xl border border-neutral-200 text-xs font-mono leading-relaxed whitespace-pre-wrap selection:bg-indigo-600 selection:text-white">
              {selectedJD.jdText}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
              <span className="text-xs text-neutral-500">
                {selectedJD.jdText.split(/\s+/).filter(Boolean).length} words • {selectedJD.jdText.length} characters
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyJD(selectedJD.jdText)}
                  className="cursor-pointer gap-1.5"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-emerald-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy Text</span>
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setSelectedJD(null)}
                  className="cursor-pointer"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Matched Candidates for selected JD */}
      {selectedCandidateJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/40 backdrop-blur-xs">
          <div className="relative z-50 w-full max-w-2xl border border-neutral-200 bg-white p-6 shadow-2xl rounded-2xl text-neutral-900 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {selectedCandidateJob.jobCode}
                  </span>
                  <h3 className="text-base font-bold text-neutral-900">
                    Matched Candidates ({selectedCandidateJob.candidatesCount})
                  </h3>
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Candidates matched for: <strong>{selectedCandidateJob.jobTitle}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCandidateJob(null)}
                className="text-neutral-400 hover:text-neutral-600 transition-colors p-1 rounded-md hover:bg-neutral-100 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {!selectedCandidateJob.matchedCandidates || selectedCandidateJob.matchedCandidates.length === 0 ? (
                <div className="py-12 text-center text-xs text-neutral-400">
                  No candidate match scores recorded for this job code in <code className="font-mono">output</code>.
                </div>
              ) : (
                selectedCandidateJob.matchedCandidates.map((c, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedScorecardCandidate(c)}
                    className="p-3 bg-neutral-50 hover:bg-neutral-100/90 rounded-xl border border-neutral-200 hover:border-indigo-300 flex items-center justify-between gap-3 transition-all cursor-pointer group shadow-2xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        {c.candidateName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-neutral-900 group-hover:text-indigo-600 transition-colors truncate">
                            {c.candidateName}
                          </p>
                          {(c.candidateId || c.candidate_id) && (
                            <span className="text-[10px] font-mono text-neutral-400 shrink-0">
                              ID: {c.candidateId || c.candidate_id}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-500 font-mono truncate">{c.candidateEmail}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="text-right">
                        <span className="text-xs font-black text-neutral-900">{c.score}%</span>
                        <p className="text-[10px] text-neutral-400">match score</p>
                      </div>
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                        (c.band || '').toLowerCase().includes('strong') || c.matchStatus === 'SELECTED'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : (c.band || '').toLowerCase().includes('partial') || c.matchStatus === 'REVIEW'
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : (c.knockout_status || '').toUpperCase() === 'BLOCKED'
                          ? 'bg-red-100 text-red-800 border-red-300'
                          : 'bg-neutral-100 text-neutral-700 border-neutral-300'
                      }`}>
                        {c.band || c.matchStatus || 'MATCHED'}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 px-2.5 bg-white text-indigo-700 border-indigo-200 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-colors cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedScorecardCandidate(c);
                        }}
                      >
                        Scorecard →
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-neutral-100">
              <Button
                size="sm"
                onClick={() => setSelectedCandidateJob(null)}
                className="cursor-pointer"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Candidate Scorecard View Modal */}
      {selectedScorecardCandidate && (
        <CandidateScorecardModal
          isOpen={!!selectedScorecardCandidate}
          candidate={selectedScorecardCandidate}
          onClose={() => setSelectedScorecardCandidate(null)}
          onBackToJob={() => setSelectedScorecardCandidate(null)}
        />
      )}
    </div>
  );
}
