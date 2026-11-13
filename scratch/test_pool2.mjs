import '../src/utils/dns-fix.ts';
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 30000,
  max: 10,
});

async function main() {
  console.log('Testing pool query...');
  const res = await pool.query('SELECT 1 as test');
  console.log('Single query worked:', res.rows);

  console.time('7 concurrent queries');
  const queries = [
    pool.query('SELECT count(*) FROM job_descriptions'),
    pool.query('SELECT count(*) FROM candidate1'),
    pool.query('SELECT count(*) FROM candidate1 WHERE assessment_status IN (\'INVITED\', \'STARTED\')'),
    pool.query('SELECT count(*) FROM candidate1 WHERE assessment_status IN (\'COMPLETED\', \'EVALUATED\')'),
    pool.query('SELECT avg(score) FROM "Assessment"'),
    pool.query('SELECT id, candidate_fname FROM candidate1 LIMIT 5'),
    pool.query('SELECT id, job_title FROM job_descriptions LIMIT 5'),
  ];
  const results = await Promise.all(queries);
  console.timeEnd('7 concurrent queries');
  console.log('Results counts:', results.map(r => r.rowCount || r.rows.length));
  await pool.end();
}

main().catch(err => {
  console.error('ERROR OCCURRED:', err);
  process.exit(1);
});

