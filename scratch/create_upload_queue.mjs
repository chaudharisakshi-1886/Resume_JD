import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const sql = `
create table if not exists upload_queue (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null,
  user_id text not null,
  position_id text,
  file_name text not null,
  file_path text not null,
  file_type text not null check (file_type in ('candidate','job')),
  status text not null default 'pending'
    check (status in ('pending','processing','done','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_upload_queue_status on upload_queue(status);
`;

console.log('Running SQL for upload_queue...');
await client.query(sql);
console.log('SQL executed successfully.');

const res = await client.query(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'upload_queue'
  ORDER BY ordinal_position;
`);

console.log('\nupload_queue table structure:');
res.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));

await client.end();

