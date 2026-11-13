import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

await client.connect();

const res = await client.query(`
  SELECT id, candidate_fname, candidate_lname, candidate_email, user_id, position_id, created_at
  FROM candidate1
  ORDER BY created_at DESC NULLS LAST
  LIMIT 10
`);

console.log('Sample candidate1 rows with user_id:');
res.rows.forEach(r => {
  console.log(`  ${r.candidate_fname} ${r.candidate_lname} | user_id: ${r.user_id} | position_id: ${r.position_id}`);
});

const withUserId = await client.query('SELECT count(*) FROM candidate1 WHERE user_id IS NOT NULL');
console.log(`\nCandidates with user_id NOT NULL: ${withUserId.rows[0].count}`);

await client.end();

