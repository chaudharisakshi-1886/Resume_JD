import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log('--- TEST 1: Check upload_queue table rows ---');
const countRes = await client.query('SELECT count(*) FROM upload_queue');
console.log('Current rows in upload_queue:', countRes.rows[0].count);

console.log('\n--- TEST 2: Call internal/process-queue with nothing pending ---');
// Simulating the POST request handler directly or testing DB query
const claimRes = await client.query(`
  SELECT id FROM upload_queue WHERE status = 'pending' LIMIT 50;
`);
console.log('Pending rows found:', claimRes.rows.length);

console.log('\n--- TEST 3: Check upload_resumes folder structure ---');
const uploadDir = process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes';
const dirs = [
  path.join(uploadDir, 'incoming', 'candidates'),
  path.join(uploadDir, 'incoming', 'jobs'),
  path.join(uploadDir, 'processed'),
  path.join(uploadDir, 'failed')
];
dirs.forEach(d => {
  console.log(`Directory ${d}: exists = ${fs.existsSync(d)}`);
});

await client.end();

