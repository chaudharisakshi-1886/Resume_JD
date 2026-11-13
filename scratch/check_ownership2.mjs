import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wbqpardlhvacrssyyerx:ParaMotor01!@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres'
});

await client.connect();

console.log('\n=== USERS ===');
const users = await client.query('SELECT id, name, email, role FROM "User" ORDER BY role, email');
users.rows.forEach(u => console.log(`  [${u.role}] ${u.email}  -->  id: ${u.id}`));

console.log('\n=== JOBS (job_descriptions) ===');
const jobs = await client.query('SELECT id, job_code, job_title, "createdBy" FROM job_descriptions ORDER BY id');
jobs.rows.forEach(j => console.log(`  id:${j.id}  code:${j.job_code}  title:${j.job_title}  createdBy:${j.createdBy}`));

console.log('\n=== CANDIDATES (candidate1) - last 20 by created_at ===');
const cands = await client.query(`
  SELECT c.id, c.candidate_fname, c.candidate_lname, c.candidate_email, c.position_id,
         j.job_code, j."createdBy" as job_owner
  FROM candidate1 c
  LEFT JOIN job_descriptions j ON c.position_id = j.id
  ORDER BY c.created_at DESC NULLS LAST
  LIMIT 20
`);
cands.rows.forEach(c =>
  console.log(`  ${c.candidate_fname} ${c.candidate_lname} | email:${c.candidate_email} | positionId:${c.position_id} | jobCode:${c.job_code} | jobOwner:${c.job_owner}`)
);

console.log('\n=== CANDIDATES WITH NULL position_id (not linked to any job) ===');
const unlinked = await client.query(`SELECT id, candidate_fname, candidate_lname, candidate_email FROM candidate1 WHERE position_id IS NULL`);
if (unlinked.rows.length === 0) console.log('  None');
else unlinked.rows.forEach(c => console.log(`  ❌ ${c.candidate_fname} ${c.candidate_lname} | ${c.candidate_email}`));

console.log('\n=== JOB createdBy MATCH vs USER IDs ===');
const userIds = users.rows.map(u => u.id);
jobs.rows.forEach(j => {
  const owner = users.rows.find(u => u.id === j.createdBy);
  if (owner) {
    console.log(`  ✅ ${j.job_code} --> owned by ${owner.email} [${owner.role}]`);
  } else {
    console.log(`  ❌ ${j.job_code} --> createdBy="${j.createdBy}" BUT NO MATCHING USER IN "User" TABLE`);
  }
});

await client.end();

