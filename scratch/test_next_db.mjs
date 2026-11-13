import { prisma } from '../src/database/db.js';

async function main() {
  console.time('dashboardQueries');
  const [j, c] = await Promise.all([
    prisma.job.count(),
    prisma.candidate.count(),
  ]);
  console.timeEnd('dashboardQueries');
  console.log('Results:', { jobs: j, candidates: c });
}

main().catch(err => {
  console.error('FAILED TO CONNECT:', err);
}).finally(() => process.exit(0));

