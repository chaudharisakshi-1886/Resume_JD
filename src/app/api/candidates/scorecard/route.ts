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
    const id = searchParams.get('id');
    const resumeId = searchParams.get('resumeId');
    const candidateId = searchParams.get('candidateId');
    const jobCode = searchParams.get('jobCode');

    let query = `
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
      WHERE 1=1
    `;

    const params: any[] = [];

    // Multi-tenant isolation: user can only access scorecards they own (or linked to their JDs)
    // ADMIN can access all if explicitly needed, but standard is isolated to caller
    if (user.role !== 'ADMIN') {
      params.push(user.id);
      query += ` AND (o.created_by = $${params.length} OR o.job_code IN (SELECT job_code FROM job_descriptions WHERE "createdBy" = $${params.length}))`;
    }

    if (id) {
      params.push(id);
      query += ` AND o.id = $${params.length}`;
    } else if (resumeId) {
      params.push(resumeId);
      query += ` AND o.resume_id = $${params.length}`;
    } else if (candidateId && jobCode) {
      params.push(candidateId.trim(), jobCode.trim());
      query += ` AND TRIM(o.candidate_id) = $${params.length - 1} AND TRIM(o.job_code) = $${params.length}`;
    } else if (candidateId) {
      params.push(candidateId.trim());
      query += ` AND TRIM(o.candidate_id) = $${params.length}`;
    } else if (jobCode) {
      params.push(jobCode.trim());
      query += ` AND TRIM(o.job_code) = $${params.length}`;
    }

    query += ` ORDER BY o.match_percent DESC NULLS LAST LIMIT 1;`;

    const res = await pool.query(query, params);

    if (res.rows.length === 0) {
      return NextResponse.json(
        { error: 'Candidate scorecard not found in output table' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      scorecard: res.rows[0],
    });
  } catch (error: any) {
    console.error('Error fetching candidate scorecard:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch candidate scorecard' },
      { status: 500 }
    );
  }
}
