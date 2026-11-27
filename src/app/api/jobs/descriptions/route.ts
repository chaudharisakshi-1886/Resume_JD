import '@/utils/dns-fix';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/auth';
import { pool } from '@/database/db';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.toLowerCase() || '';
    const scopeParam = searchParams.get('scope');
    const isAdmin = user.role === 'ADMIN';
    // Strictly show current logged-in user's jobs by default; Admin sees all only when scope=all
    const allForAdmin = isAdmin && scopeParam === 'all';

    // When filtering by 'mine', include both admin user IDs if the caller is admin
    const adminIds = ['seeded-admin-user-id', 'd82463e2-872f-4886-9a25-cfb89cbe3412'];
    if (isAdmin && !adminIds.includes(user.id)) {
      adminIds.push(user.id);
    }

    const jdCondition = allForAdmin
      ? ''
      : (isAdmin ? `WHERE jd."createdBy" = ANY($1)` : `WHERE jd."createdBy" = $1`);
    const jdParams: any[] = allForAdmin ? [] : (isAdmin ? [adminIds] : [user.id]);

    // Query job_descriptions joined with candidate counts from output1 table
    const res = await pool.query(`
      SELECT 
        jd.content_hash as "contentHash",
        COALESCE(jd.job_code, 'N/A') as "jobCode",
        COALESCE(jd.job_title, 'Untitled Job') as "jobTitle",
        COALESCE(jd.jd_text, '') as "jdText",
        jd.created_at as "createdAt",
        COALESCE(jd.status, 'Active') as "status",
        NULL::timestamptz as "inactiveAt",
        COALESCE(jd."createdBy", '') as "createdBy",
        COALESCE(m.candidates_count, 0)::int as "candidatesCount"
      FROM job_descriptions jd
      LEFT JOIN (
        SELECT TRIM(job_code) as job_code, COUNT(DISTINCT candidate_id) as candidates_count
        FROM output1
        WHERE job_code IS NOT NULL
        GROUP BY TRIM(job_code)
      ) m ON TRIM(m.job_code) = TRIM(jd.job_code)
      ${jdCondition}
      ORDER BY jd.created_at DESC;
    `, jdParams);

    let jobDescriptions = res.rows;

    if (search) {
      jobDescriptions = jobDescriptions.filter((j: any) =>
        (j.jobTitle && j.jobTitle.toLowerCase().includes(search)) ||
        (j.jobCode && j.jobCode.toLowerCase().includes(search)) ||
        (j.jdText && j.jdText.toLowerCase().includes(search))
      );
    }

    // Fetch matched candidates summary joined with candidate profiles from candidate1 table
    // Strictly isolate output to records belonging to user's JDs
    const outCondition = allForAdmin
      ? ''
      : (isAdmin
          ? `WHERE o.job_code IN (SELECT job_code FROM job_descriptions WHERE "createdBy" = ANY($1))`
          : `WHERE o.job_code IN (SELECT job_code FROM job_descriptions WHERE "createdBy" = $1)`);
    const outParams: any[] = allForAdmin ? [] : (isAdmin ? [adminIds] : [user.id]);

    const candidatesRes = await pool.query(`
      SELECT 
        o.id,
        o.resume_id as "resumeId",
        o.candidate_id as "candidateId",
        COALESCE(o.candidate_name, 'Unknown') as "candidateName",
        COALESCE(o.candidate_email, 'No Email') as "candidateEmail",
        TRIM(o.job_code) as "jobCode",
        o.job_title as "jobTitle",
        o.job_seniority as "jobSeniority",
        COALESCE(o.match_percent, 0)::float as "score",
        o.match_percent as "match_percent",
        o.band,
        o.coverage_matched as "coverage_matched",
        o.coverage_total as "coverage_total",
        o.coverage_percent as "coverage_percent",
        o.coverage_text as "coverage_text",
        o.score_skills as "score_skills",
        o.score_experience as "score_experience",
        o.score_responsibilities as "score_responsibilities",
        o.score_domain as "score_domain",
        o.score_seniority as "score_seniority",
        o.score_education as "score_education",
        o.dimension_scores as "dimension_scores",
        o.dimension_contributions as "dimension_contributions",
        o.matched_skills as "matched_skills",
        o.gap_skills as "gap_skills",
        o.knockout_status as "knockout_status",
        o.knockout_flags as "knockout_flags",
        o.data_confidence as "data_confidence",
        o.recommended_next_step as "recommended_next_step",
        o.explanation,
        o.created_at as "createdAt",
        COALESCE(o.band, o.recommended_next_step, 'MATCHED') as "matchStatus",
        c.phone,
        c.current_job_title as "current_job_title",
        c.current_company as "current_company",
        c.years_of_experience as "years_of_experience",
        c.seniority as "candidate_seniority",
        COALESCE(c.candidate_location, c.candidate_address) as "location"
      FROM output1 o
      LEFT JOIN candidate1 c ON TRIM(c.candidate_id) = TRIM(o.candidate_id)
      ${outCondition}
      ORDER BY o.match_percent DESC NULLS LAST;
    `, outParams);

    // Fetch total distinct matched candidates across user's jobs in output1
    const totalCandidatesRes = await pool.query(`
      SELECT COUNT(DISTINCT o.candidate_id) as count
      FROM output1 o
      ${outCondition};
    `, outParams).catch(() => ({ rows: [{ count: '0' }] }));
    const totalMatchedCandidates = parseInt(totalCandidatesRes.rows[0]?.count || '0', 10);

    const candidatesByJob: Record<string, any[]> = {};
    candidatesRes.rows.forEach((c: any) => {
      const code = c.jobCode ? c.jobCode.trim() : '';
      if (code) {
        if (!candidatesByJob[code]) {
          candidatesByJob[code] = [];
        }
        candidatesByJob[code].push(c);
      }
    });

    const enrichedDescriptions = jobDescriptions.map((jd: any) => {
      const code = jd.jobCode ? jd.jobCode.trim() : '';
      const matched = code ? (candidatesByJob[code] || []) : [];
      return {
        ...jd,
        candidatesCount: jd.candidatesCount || matched.length,
        matchedCandidates: matched,
      };
    });

    return NextResponse.json({
      success: true,
      jobDescriptions: enrichedDescriptions,
      totalMatchedCandidates,
    });
  } catch (error: any) {
    console.error('Error fetching job_descriptions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch job descriptions from database' },
      { status: 500 }
    );
  }
}
