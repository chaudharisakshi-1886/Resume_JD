import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

await client.connect();

console.log('=== 1. USERS ===');
const users = await client.query('SELECT id, name, email, role FROM "User" ORDER BY role, email');
users.rows.forEach(u => console.log(`  [${u.role}] ${u.email} (id: ${u.id})`));

console.log('\n=== 2. JOBS (job_descriptions) ===');
const jobs = await client.query('SELECT id, job_code, job_title, "createdBy", created_at FROM job_descriptions ORDER BY id');
console.log(`Total jobs: ${jobs.rows.length}`);
jobs.rows.forEach(j => console.log(`  id:${j.id} | code:${j.job_code} | title:${j.job_title} | createdBy:${j.createdBy}`));

console.log('\n=== 3. CANDIDATES (candidate1) ===');
const candsCount = await client.query('SELECT count(*) FROM candidate1');
console.log(`Total candidates: ${candsCount.rows[0].count}`);

const unlinked = await client.query('SELECT count(*) FROM candidate1 WHERE position_id IS NULL');
console.log(`Candidates with NULL position_id: ${unlinked.rows[0].count}`);

console.log('\n=== Latest 5 candidates inserted or updated: ===');
const latestCands = await client.query(`
  SELECT c.id, c.candidate_fname, c.candidate_lname, c.candidate_email, c.position_id, c.created_at, j.job_code
  FROM candidate1 c
  LEFT JOIN job_descriptions j ON c.position_id = j.id
  ORDER BY c.created_at DESC NULLS LAST
  LIMIT 5
`);
latestCands.rows.forEach(c => {
  console.log(`  ${c.candidate_fname} ${c.candidate_lname} | email: ${c.candidate_email} | position_id: ${c.position_id} (${c.job_code || 'NO JOB'}) | created: ${c.created_at}`);
});

console.log('\n=== 4. UPLOAD BATCHES ===');
const batches = await client.query('SELECT id, batch_type, status, total_received, inserted_count, created_at FROM upload_batches ORDER BY created_at DESC LIMIT 3');
if (batches.rows.length === 0) {
  console.log('  No batches found');
} else {
  batches.rows.forEach(b => console.log(`  batch: ${b.id} | type: ${b.batch_type} | status: ${b.status} | inserted: ${b.inserted_count}/${b.total_received} | at: ${b.created_at}`));
}

await client.end();

