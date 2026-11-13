import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function big(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? v.toString() : v));
}

async function main() {
  // 1. All users
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true }
  });
  console.log('\n=== USERS ===');
  users.forEach(u => console.log(`  [${u.role}] ${u.email}  -->  id: ${u.id}`));

  // 2. All jobs with createdBy
  const jobs = await prisma.job.findMany({
    select: { id: true, jobCode: true, title: true, createdBy: true }
  });
  console.log('\n=== JOBS (job_descriptions) ===');
  jobs.forEach(j => console.log(`  jobCode: ${j.jobCode}  id: ${j.id}  createdBy: ${j.createdBy}`));

  // 3. All candidates with positionId
  const candidates = await prisma.candidate.findMany({
    select: { id: true, fname: true, lname: true, email: true, positionId: true, uploadBatchId: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log('\n=== CANDIDATES (candidate1) - last 20 ===');
  candidates.forEach(c =>
    console.log(`  ${c.fname} ${c.lname}  |  email: ${c.email}  |  positionId: ${c.positionId}  |  batchId: ${c.uploadBatchId}`)
  );

  // 4. Cross-check: candidates whose job has a mismatched or NULL createdBy
  console.log('\n=== CANDIDATES WITH NULL positionId (not linked to any job) ===');
  const unlinked = await prisma.candidate.findMany({
    where: { positionId: null },
    select: { id: true, fname: true, lname: true, email: true }
  });
  if (unlinked.length === 0) console.log('  None — all candidates are linked to a job');
  else unlinked.forEach(c => console.log(`  ${c.fname} ${c.lname}  ${c.email}  id: ${c.id}`));

  // 5. Show each job's createdBy vs user list
  console.log('\n=== JOB createdBy MATCH CHECK ===');
  const userIds = users.map(u => u.id);
  jobs.forEach(j => {
    const owner = users.find(u => u.id === j.createdBy);
    if (owner) {
      console.log(`  ✅ ${j.jobCode} owned by ${owner.email} (${owner.role})`);
    } else {
      console.log(`  ❌ ${j.jobCode} createdBy="${j.createdBy}" — NO MATCHING USER IN DB`);
    }
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());

