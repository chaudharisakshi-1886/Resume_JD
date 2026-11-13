import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  ALTER TABLE job_descriptions ADD CONSTRAINT uq_job_descriptions_content_hash UNIQUE (content_hash);
`).catch(e => console.log('Constraint note:', e.message));

console.log('Added unique constraint on job_descriptions.content_hash');
await client.end();

