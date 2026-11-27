import Link from 'next/link';
import { prisma } from '@/database/db';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Briefcase, Users, Hourglass, CheckSquare, Award, ArrowUpRight, Plus, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

import { getCurrentUser } from '@/utils/auth';
import { redirect } from 'next/navigation';
import { getJobScope, getCandidateScope } from '@/services/authz';

export const revalidate = 0; // Dynamic server page

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const jobScope = getJobScope(user, { allForAdmin: false });
  const candidateScope = getCandidateScope(user, { allForAdmin: false });
  const assessmentScope = { candidate: candidateScope };

  // Run queries in parallel
  const [
    totalJobs,
    totalCandidates,
    pendingCount,
    completedCount,
    avgScoreData,
    recentCandidates,
    jobsList,
  ] = await Promise.all([
    prisma.job.count({ where: jobScope }),
    prisma.candidate.count({ where: candidateScope }),
    prisma.candidate.count({
      where: {
        ...candidateScope,
        assessmentStatus: { in: ['INVITED', 'STARTED'] },
      },
    }),
    prisma.candidate.count({
      where: {
        ...candidateScope,
        assessmentStatus: { in: ['COMPLETED', 'EVALUATED'] },
      },
    }),
    prisma.assessment.aggregate({
      where: assessmentScope,
      _avg: {
        score: true,
      },
    }),
    prisma.candidate.findMany({
      where: candidateScope,
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        job: { select: { title: true } },
        assessments: { select: { score: true } },
      },
    }),
    prisma.job.findMany({
      where: jobScope,
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { candidates: true } },
      },
    }),
  ]);

  const avgScore = avgScoreData._avg.score ? Math.round(avgScoreData._avg.score * 10) / 10 : 0;
  const avgPercentage = avgScore ? Math.round(avgScore * 10) : 0;

  // Candidate status distributions
  const invitedCount = await prisma.candidate.count({ where: { ...candidateScope, assessmentStatus: 'INVITED' } });
  const startedCount = await prisma.candidate.count({ where: { ...candidateScope, assessmentStatus: 'STARTED' } });
  const compCount = await prisma.candidate.count({ where: { ...candidateScope, assessmentStatus: 'COMPLETED' } });
  const evalCount = await prisma.candidate.count({ where: { ...candidateScope, assessmentStatus: 'EVALUATED' } });

  const statusMetrics = [
    { name: 'Invited', count: invitedCount, color: 'bg-neutral-300' },
    { name: 'Started', count: startedCount, color: 'bg-amber-400' },
    { name: 'Completed', count: compCount, color: 'bg-indigo-500' },
    { name: 'Evaluated', count: evalCount, color: 'bg-emerald-500' },
  ];

  const maxStatusCount = Math.max(...statusMetrics.map((m) => m.count), 1);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Greetings Header */}
      <PageHeader
        title={`Welcome back, ${user.name}`}
        description={
          user.role === 'ADMIN'
            ? 'Full platform visibility across all company recruiters, job openings, and candidate evaluations.'
            : 'Real-time candidate pipelines and assessments for your uploaded positions.'
        }
        badge={
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              user.role === 'ADMIN'
                ? 'bg-indigo-100 text-indigo-800 border border-indigo-200/60'
                : 'bg-neutral-100 text-neutral-700 border border-neutral-200/60'
            }`}
          >
            {user.role === 'ADMIN' ? 'Super Admin' : 'Recruiter Workspace'}
          </span>
        }
      >
        <Link href="/dashboard/jobs/upload">
          <Button size="sm" variant="outline" className="cursor-pointer gap-1.5 font-medium border-neutral-300 hover:bg-neutral-50 shadow-2xs">
            <UploadCloud className="h-4 w-4 text-neutral-600" />
            <span>Bulk Upload</span>
          </Button>
        </Link>
        <Link href="/dashboard/jobs/new">
          <Button size="sm" className="cursor-pointer gap-1.5 font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs">
            <Plus className="h-4 w-4" />
            <span>Post New Job</span>
          </Button>
        </Link>
      </PageHeader>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Total Jobs"
          value={totalJobs}
          icon={Briefcase}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50/80 border-indigo-100"
        />
        <MetricCard
          label="Candidates"
          value={totalCandidates}
          icon={Users}
          iconColor="text-blue-600"
          iconBg="bg-blue-50/80 border-blue-100"
        />
        <MetricCard
          label="Pending Tests"
          value={pendingCount}
          icon={Hourglass}
          iconColor="text-amber-600"
          iconBg="bg-amber-50/80 border-amber-100"
        />
        <MetricCard
          label="Completed"
          value={completedCount}
          icon={CheckSquare}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50/80 border-emerald-100"
        />
        <MetricCard
          label="Avg Score"
          value={avgScore > 0 ? `${avgPercentage}%` : 'N/A'}
          icon={Award}
          iconColor="text-violet-600"
          iconBg="bg-violet-50/80 border-violet-100"
        />
      </div>

      {/* Row with Charts and Recents */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Status distribution chart */}
        <Card className="lg:col-span-1 flex flex-col h-full">
          <div className="p-6 border-b border-neutral-100">
            <h3 className="text-sm font-semibold text-neutral-900">Candidate Flow</h3>
            <p className="text-[11px] text-neutral-500 mt-1">Status distribution of all invitees.</p>
          </div>
          <CardContent className="p-6 flex-1 flex flex-col justify-center space-y-4">
            {statusMetrics.map((m) => {
              const percentage = (m.count / maxStatusCount) * 100;
              return (
                <div key={m.name} className="space-y-1">
                  <div className="flex justify-between text-xs text-neutral-700">
                    <span className="font-medium">{m.name}</span>
                    <span className="font-semibold text-neutral-900">{m.count}</span>
                  </div>
                  <div className="h-2 w-full bg-neutral-100 rounded-sm overflow-hidden">
                    <div
                      className={`h-full ${m.color} transition-all duration-500`}
                      style={{ width: `${Math.max(percentage, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Recent Candidate Activities */}
        <Card className="lg:col-span-2 flex flex-col h-full">
          <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Recent Candidates</h3>
              <p className="text-[11px] text-neutral-500 mt-1">Status details of the latest invitees.</p>
            </div>
            <Link href="/dashboard/candidates" className="text-xs text-neutral-600 hover:text-neutral-900 font-medium inline-flex items-center gap-0.5">
              <span>View all</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="flex-1">
            {recentCandidates.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No candidates invited yet"
                description="Invite candidates or import applicant resumes to start automated assessments."
                actionHref="/dashboard/candidates"
                actionLabel="Invite First Candidate"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Applied Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCandidates.map((c: any) => {
                    const candidateScore = c.assessments[0]?.score;
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="text-xs font-semibold text-neutral-900">
                            {[c.fname, c.lname].filter(Boolean).join(' ') || 'Candidate'}
                          </div>
                          <div className="text-[10px] text-neutral-500">{c.email}</div>
                        </TableCell>
                        <TableCell className="text-xs text-neutral-700">
                          {c.job?.title || c.currentJobTitle || 'Not Assigned'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={c.assessmentStatus} />
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold text-neutral-900">
                          {candidateScore !== undefined && candidateScore !== null
                            ? `${Math.round(candidateScore * 10)}%`
                            : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      {/* Active Jobs Performance */}
      <Card>
        <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">Active Job Positions</h3>
            <p className="text-[11px] text-neutral-500 mt-1">Overview of currently posted jobs and application counts.</p>
          </div>
          <Link href="/dashboard/jobs" className="text-xs text-neutral-600 hover:text-neutral-900 font-medium inline-flex items-center gap-0.5">
            <span>View all jobs</span>
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div>
          {jobsList.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No jobs posted yet"
              description="Create a new job description or use bulk upload to import positions."
              actionHref="/dashboard/jobs/new"
              actionLabel="Post New Job"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Experience</TableHead>
                  <TableHead className="text-right">Candidates</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobsList.map((j: any) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-xs font-semibold text-neutral-900">
                      <Link href={`/dashboard/jobs`} className="hover:underline">
                        {j.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-neutral-700">{j.department}</TableCell>
                    <TableCell className="text-xs text-neutral-600">{j.location}</TableCell>
                    <TableCell className="text-xs text-neutral-600">{j.experience}</TableCell>
                    <TableCell className="text-right text-xs font-bold text-neutral-900">
                      {j._count.candidates}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
