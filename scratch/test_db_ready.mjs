import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wbqpardlhvacrssyyerx:ParaMotor01!@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'
});

await client.connect();
const resUsers = await client.query('SELECT count(*) FROM "User"');
const resCandidates = await client.query('SELECT count(*) FROM candidate1');
const resJobs = await client.query('SELECT count(*) FROM job_descriptions');
console.log(`DATABASE IS ALIVE AND WORKING!`);
console.log(`  Users count: ${resUsers.rows[0].count}`);
console.log(`  Jobs count: ${resJobs.rows[0].count}`);
console.log(`  Candidates count: ${resCandidates.rows[0].count}`);
await client.end();
