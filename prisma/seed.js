const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding PostgreSQL database with test assessment data matching CSV Job IDs...');

  // 1. Clean existing records (cascade drops candidate & assessment entries)
  try {
    await prisma.assessment.deleteMany({});
    await prisma.slotBooking.deleteMany({});
    await prisma.slot.deleteMany({});
    await prisma.questionBank.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.job.deleteMany({ where: { id: { in: [1100112n, 1100115n, 1100118n, 1100128n, 1100135n] } } });
    await prisma.user.deleteMany({});
    await pool.query(`DELETE FROM job_descriptions WHERE job_code IN ('J001', 'J002');`);
    console.log('Cleared existing database records successfully.');
  } catch (err) {
    console.log('Error clearing tables (might be empty):', err.message);
  }

  // 2. Seed Admin User and Recruiter User from environment configuration
  const adminEmail = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
  const recruiterEmail = (process.env.DEFAULT_RECRUITER_EMAIL || 'recruiter@gmail.com').trim().toLowerCase();
  const recruiterPassword = process.env.DEFAULT_RECRUITER_PASSWORD || 'recruiter123';

  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  const adminUser = await prisma.user.create({
    data: {
      id: 'seeded-admin-user-id',
      name: 'Super Admin',
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
    },
  });
  console.log('Seeded Admin Account:', adminUser.email);

  const recruiterPasswordHash = await bcrypt.hash(recruiterPassword, 10);
  const recruiterUser = await prisma.user.create({
    data: {
      id: 'seeded-recruiter-user-id',
      name: 'Lead Recruiter',
      email: recruiterEmail,
      passwordHash: recruiterPasswordHash,
      role: 'RECRUITER',
    },
  });
  console.log('Seeded Recruiter Account:', recruiterUser.email);

  // 3. Create job positions matching CSV Job IDs (1100112, 1100115, 1100118, 1100128, 1100135)
  const job1 = await prisma.job.create({
    data: {
      id: 1100112n,
      title: 'Senior Full-Stack Developer',
      department: 'Engineering',
      location: 'Remote (USA)',
      experience: '5+ years',
      status: 'ACTIVE',
      jdRawText: 'Looking for a Senior Full-Stack Engineer skilled in React, Next.js, Node.js, and SQL databases. Experience with TypeScript and database schema migrations is required.',
      skills: ['TypeScript', 'Next.js', 'Prisma', 'PostgreSQL', 'React'],
      mustHave: [
        '5+ years of fullstack web development experience',
        'Strong experience with TypeScript and modern frameworks (Next.js)',
        'Experience with Prisma and SQL databases',
      ],
      goodToHave: [
        'Experience with Supabase and Tailwind CSS',
        'Knowledge of n8n or AI integrations',
      ],
      seniority: 'Senior',
      topics: ['System Architecture', 'Database & ORMs', 'API Implementation', 'State Management'],
      weights: {
        TypeScript: 30,
        'Next.js': 25,
        Prisma: 20,
        PostgreSQL: 15,
        React: 10,
      },
      createdBy: adminUser.id,
    },
  });

  const job2 = await prisma.job.create({
    data: {
      id: 1100115n,
      title: 'Backend Database Engineer',
      department: 'Infrastructure',
      location: 'New York, NY',
      experience: '3+ years',
      status: 'ACTIVE',
      jdRawText: 'We are seeking a Backend Engineer with deep knowledge of PostgreSQL optimization, Node.js REST API construction, and database connection pooling in serverless environments.',
      skills: ['Node.js', 'PostgreSQL', 'Connection Pooling', 'REST APIs'],
      mustHave: [
        '3+ years of backend development experience',
        'Expertise in PostgreSQL database design and query optimization',
        'Experience building RESTful APIs in Node.js',
      ],
      goodToHave: ['Understanding of serverless database constraints', 'Familiarity with Docker'],
      seniority: 'Mid-Level',
      topics: ['Database & ORMs', 'API Implementation', 'System Architecture'],
      weights: {
        'Node.js': 30,
        PostgreSQL: 30,
        'Connection Pooling': 20,
        'REST APIs': 20,
      },
      createdBy: adminUser.id,
    },
  });

  const job3 = await prisma.job.create({
    data: {
      id: 1100118n,
      title: 'Frontend React Developer',
      department: 'Product',
      location: 'San Francisco, CA',
      experience: '4+ years',
      status: 'ACTIVE',
      jdRawText: 'Frontend developer to build rich user interfaces, handle client-side rendering performance, state hooks, and style widgets with responsive HTML/CSS systems.',
      skills: ['React', 'CSS', 'HTML', 'State Management'],
      mustHave: [
        '4+ years of frontend application design experience',
        'Expertise in React component design patterns and state managers',
      ],
      goodToHave: ['Tailwind CSS', 'Framer Motion animation library'],
      seniority: 'Senior',
      topics: ['State Management', 'System Architecture'],
      weights: {
        React: 40,
        'State Management': 30,
        CSS: 20,
        HTML: 10,
      },
      createdBy: adminUser.id,
    },
  });

  const job4 = await prisma.job.create({
    data: {
      id: 1100128n,
      title: 'DevOps Infrastructure Engineer',
      department: 'Operations',
      location: 'Austin, TX',
      experience: '5+ years',
      status: 'ACTIVE',
      jdRawText: 'Kubernetes containers orchestration, Docker builder files, cloud setup on AWS ECS task models, CI/CD pipeline automation workflows.',
      skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD'],
      mustHave: [
        '5+ years of production DevOps automation workflows',
        'Deep expertise in container architectures and deployment configurations',
      ],
      goodToHave: ['Terraform IaC script building', 'Log aggregation tools'],
      seniority: 'Senior',
      topics: ['System Architecture'],
      weights: {
        Kubernetes: 40,
        Docker: 25,
        AWS: 20,
        'CI/CD': 15,
      },
      createdBy: recruiterUser.id,
    },
  });

  const job5 = await prisma.job.create({
    data: {
      id: 1100135n,
      title: 'PM & System Architect',
      department: 'Engineering',
      location: 'Remote',
      experience: '7+ years',
      status: 'ACTIVE',
      jdRawText: 'Design system architectures, coordinate microservice communication, write protocol schemas, define integration scopes.',
      skills: ['Architecture', 'API Integration', 'Security Protocols'],
      mustHave: [
        '7+ years designing enterprise service-oriented backends',
      ],
      goodToHave: ['Technical product coordination experience'],
      seniority: 'Lead',
      topics: ['System Architecture', 'API Implementation'],
      weights: {
        Architecture: 50,
        'API Integration': 30,
        'Security Protocols': 20,
      },
      createdBy: recruiterUser.id,
    },
  });

  console.log('Seeded Job Postings matching CSV Job IDs successfully.');

  // 4. Seed QuestionBank (25 questions for Job 1 and 25 for Job 2)
  const fullstackQuestions = [
    // System Architecture
    { question: 'Explain the difference between Server Components and Client Components in Next.js.', topic: 'System Architecture' },
    { question: 'What is hydration in modern JavaScript frameworks, and how does React handle it?', topic: 'System Architecture' },
    { question: 'How does server-side rendering (SSR) compare to static site generation (SSG) in terms of latency?', topic: 'System Architecture' },
    { question: 'Describe how React 19 Server Actions process forms and mutate state on the server.', topic: 'System Architecture' },
    { question: 'What is code splitting, and how does dynamic importing improve frontend performance?', topic: 'System Architecture' },
    { question: 'How would you deploy a distributed Next.js project on edge network endpoints?', topic: 'System Architecture' },
    // Database & ORMs
    { question: 'What is database connection pooling, and why is it essential for serverless backend functions?', topic: 'Database & ORMs' },
    { question: 'Explain the N+1 query problem in ORMs like Prisma, and how to resolve it.', topic: 'Database & ORMs' },
    { question: 'What are database indexes, and how do they speed up database search queries?', topic: 'Database & ORMs' },
    { question: 'How do you handle database migrations safely in a team of multiple developers?', topic: 'Database & ORMs' },
    { question: 'What are transaction isolation levels, and how do they protect database consistency?', topic: 'Database & ORMs' },
    { question: 'Explain the difference between database push (npx prisma db push) and migration deploy.', topic: 'Database & ORMs' },
    // API Implementation
    { question: 'Describe the differences between REST APIs, GraphQL, and gRPC.', topic: 'API Implementation' },
    { question: 'How do you validate incoming request payloads in route handlers (e.g., using Zod)?', topic: 'API Implementation' },
    { question: 'What mechanisms protect a REST API against Cross-Site Request Forgery (CSRF) attacks?', topic: 'API Implementation' },
    { question: 'How does rate limiting prevent Denial of Service (DoS) abuses on public API routes?', topic: 'API Implementation' },
    { question: 'Explain how JWT signatures prevent client-side token tampering.', topic: 'API Implementation' },
    { question: 'What is CORS, and how do preflight requests protect web browser clients?', topic: 'API Implementation' },
    // State Management
    { question: 'Compare Zustand with Redux and React Context for global application state management.', topic: 'State Management' },
    { question: 'How do you synchronize client-side global store values with server-side cookies or sessions?', topic: 'State Management' },
    { question: 'What is state hoisting, and when should component state be lifted to parent nodes?', topic: 'State Management' },
    { question: 'Explain cache invalidation strategies in frontend caching clients (e.g., React Query).', topic: 'State Management' },
    { question: 'How do you prevent unnecessary React component re-renders when using store selectors?', topic: 'State Management' },
    { question: 'What is the role of immutability in React state updates?', topic: 'State Management' },
    { question: 'Explain how optimistic updates improve client UI perceived performance during mutations.', topic: 'State Management' }
  ];

  const backendQuestions = [
    // Database & ORMs
    { question: 'How do you optimize a PostgreSQL query that has high latency and execution time?', topic: 'Database & ORMs' },
    { question: 'Explain the difference between GIN, B-Tree, and Hash indexes in PostgreSQL.', topic: 'Database & ORMs' },
    { question: 'What is a dead lock in database transactions, and how does PostgreSQL resolve it?', topic: 'Database & ORMs' },
    { question: 'Explain how database clustering and read-replicas scale database select operations.', topic: 'Database & ORMs' },
    { question: 'How do database connection pools (like PgBouncer) handle high volume concurrent clients?', topic: 'Database & ORMs' },
    { question: 'What is schema normalization, and when is denormalization appropriate in high read systems?', topic: 'Database & ORMs' },
    { question: 'What are database foreign keys, and how do cascade delete rules function?', topic: 'Database & ORMs' },
    { question: 'How do you run database migrations without causing downtime in production?', topic: 'Database & ORMs' },
    // API Implementation
    { question: 'How do you construct a middleware chain in Node.js for authentication and logging?', topic: 'API Implementation' },
    { question: 'What is the HTTP response status code 409 Conflict, and when should it be returned?', topic: 'API Implementation' },
    { question: 'How do you handle heavy asynchronous tasks (like PDF rendering) without blocking the Node event loop?', topic: 'API Implementation' },
    { question: 'Explain how OAuth2 authorization code flow works.', topic: 'API Implementation' },
    { question: 'What are security best practices for storing and comparing user passwords?', topic: 'API Implementation' },
    { question: 'How do you handle API versioning (e.g. headers vs path parameters) in production?', topic: 'API Implementation' },
    { question: 'What is a token bucket algorithm, and how is it used in API rate limiters?', topic: 'API Implementation' },
    { question: 'Describe how structured JSON logging improves production debug visibility.', topic: 'API Implementation' },
    // System Architecture
    { question: 'Explain the Event Loop in Node.js. What is the microtask queue?', topic: 'System Architecture' },
    { question: 'How does Redis cache data, and what are common cache invalidation policies?', topic: 'System Architecture' },
    { question: 'Describe the differences between microservices and monolithic architectures.', topic: 'System Architecture' },
    { question: 'What is horizontal scaling, and how does a reverse proxy load balancer distribute traffic?', topic: 'System Architecture' },
    { question: 'How do message queues (like RabbitMQ or BullMQ) process async background worker tasks?', topic: 'System Architecture' },
    { question: 'What is the CAP Theorem in distributed databases?', topic: 'System Architecture' },
    { question: 'Explain how circuit breakers prevent cascading failures in service dependencies.', topic: 'System Architecture' },
    { question: 'What is log aggregation, and why is it crucial for microservice environments?', topic: 'System Architecture' },
    { question: 'How do containerization (Docker) and orchestration (Kubernetes) scale backend microservices?', topic: 'System Architecture' }
  ];

  for (const q of fullstackQuestions) {
    await prisma.questionBank.create({
      data: {
        positionId: job1.id,
        question: q.question,
        topic: q.topic,
      }
    });
  }

  for (const q of backendQuestions) {
    await prisma.questionBank.create({
      data: {
        positionId: job2.id,
        question: q.question,
        topic: q.topic,
      }
    });
  }

  console.log('Seeded QuestionBank pools (25 questions per job opening).');

  // 5. Seed Slots
  const now = new Date();
  
  // Slot 1: Active, in 1 day
  const slot1 = await prisma.slot.create({
    data: {
      startTime: new Date(now.getTime() + 3600000 * 24), // +24h
      endTime: new Date(now.getTime() + 3600000 * 26),   // +26h
      capacity: 5,
      bookedCount: 0,
      status: 'ACTIVE'
    }
  });

  // Slot 2: Active, in 2 days
  const slot2 = await prisma.slot.create({
    data: {
      startTime: new Date(now.getTime() + 3600000 * 48), // +48h
      endTime: new Date(now.getTime() + 3600000 * 50),   // +50h
      capacity: 5,
      bookedCount: 0,
      status: 'ACTIVE'
    }
  });

  // Slot 3: Active, in 3 hours (starts very soon)
  const slot3 = await prisma.slot.create({
    data: {
      startTime: new Date(now.getTime() + 3600000 * 3), // +3h
      endTime: new Date(now.getTime() + 3600000 * 5),   // +5h
      capacity: 5,
      bookedCount: 0,
      status: 'ACTIVE'
    }
  });

  // Slot 4: Full, in 3 days
  const slot4 = await prisma.slot.create({
    data: {
      startTime: new Date(now.getTime() + 3600000 * 72), // +72h
      endTime: new Date(now.getTime() + 3600000 * 74),   // +74h
      capacity: 2,
      bookedCount: 2,
      status: 'ACTIVE'
    }
  });

  // Slot 5: Expired (ended yesterday)
  const slot5 = await prisma.slot.create({
    data: {
      startTime: new Date(now.getTime() - 3600000 * 26), // -26h
      endTime: new Date(now.getTime() - 3600000 * 24),   // -24h
      capacity: 5,
      bookedCount: 1,
      status: 'ACTIVE'
    }
  });

  console.log('Seeded Booking Slots (Available, Full, Expired).');

  // 6. Seed Candidate records
  // Candidate 1: Graded and Evaluated (Job 1 - Admin)
  const c1 = await prisma.candidate.create({
    data: {
      positionId: job1.id,
      candidateId: '1678433',
<<<<<<< Updated upstream
      fname: 'Alice',
=======
      fname: 'John',
>>>>>>> Stashed changes
      lname: 'Smith',
      email: 'alice.smith@email.com',
      phone: '+1 (555) 019-2834',
      assessmentStatus: 'EVALUATED',
      assessmentToken: 'alice-demo-token-999',
    },
  });

  // Candidate 2: Finished but grading pending (Job 2 - Admin)
  const c2 = await prisma.candidate.create({
    data: {
      positionId: job2.id,
      candidateId: '1678438',
<<<<<<< Updated upstream
      fname: 'Bob',
      lname: 'Williams',
      email: 'bob.williams@email.com',
=======
      fname: 'John',
      lname: 'Smith',
      email: 'john.smith@email.com',
>>>>>>> Stashed changes
      phone: '+1 (555) 888-2940',
      assessmentStatus: 'COMPLETED',
      assessmentToken: 'bob-demo-token-888',
    },
  });

  // Candidate 3: Booked slot, scheduled (Job 1 - Admin)
  const c3 = await prisma.candidate.create({
    data: {
      positionId: job1.id,
      candidateId: '1678440',
<<<<<<< Updated upstream
      fname: 'Charlie',
      lname: 'Brown',
      email: 'charlie.brown@email.com',
=======
      fname: 'John',
      lname: 'Smith',
      email: 'john.smith@email.com',
>>>>>>> Stashed changes
      assessmentStatus: 'SCHEDULED',
      assessmentToken: 'charlie-demo-token-777',
    },
  });

  await prisma.slotBooking.create({
    data: {
      candidateId: c3.id,
      slotId: slot3.id,
    }
  });

  // Candidate 4: Shortlisted (Job 1 - Admin)
  const c4 = await prisma.candidate.create({
    data: {
      positionId: job1.id,
      candidateId: '1005',
      fname: 'Sophia',
      lname: 'Johnson',
      email: 'sophia.johnson@email.com',
      assessmentStatus: 'SHORTLISTED',
      assessmentToken: 'sophia-demo-token-666',
    },
  });

  // Candidate 5: Just Invited (Job 1 - Admin)
  const c5 = await prisma.candidate.create({
    data: {
      positionId: job1.id,
      candidateId: '1006',
      fname: 'Michael',
      lname: 'Lee',
      email: 'michael.lee@email.com',
      assessmentStatus: 'INVITED',
      assessmentToken: 'michael-demo-token-555',
    },
  });

  // Candidate 6: Recruiter's Job (Job 4 - Recruiter)
  const c6 = await prisma.candidate.create({
    data: {
      positionId: job4.id,
      candidateId: '2001',
      fname: 'David',
      lname: 'DevOps',
      email: 'david.devops@email.com',
      assessmentStatus: 'EVALUATED',
      assessmentToken: 'david-recruiter-token-111',
    },
  });

  // Candidate 7: Recruiter's Job (Job 5 - Recruiter)
  const c7 = await prisma.candidate.create({
    data: {
      positionId: job5.id,
      candidateId: '2002',
      fname: 'Emma',
      lname: 'Architect',
      email: 'emma.architect@email.com',
      assessmentStatus: 'SHORTLISTED',
      assessmentToken: 'emma-recruiter-token-222',
    },
  });

  console.log('Seeded Candidates list matching CSV records successfully.');

  // 7. Seed Assessment evaluations
  const selectedQuestionsForAlice = fullstackQuestions.slice(0, 3).map((q, idx) => ({
    id: `q-${idx}`,
    question: q.question,
    topic: q.topic
  }));

  const selectedQuestionsForBob = backendQuestions.slice(0, 2).map((q, idx) => ({
    id: `q-${idx}`,
    question: q.question,
    topic: q.topic
  }));

  // Alice Assessment
  await prisma.assessment.create({
    data: {
      candidateId: c1.id,
      jobId: job1.id,
      questions: selectedQuestionsForAlice,
      assignedQuestionIds: selectedQuestionsForAlice.map(q => q.id),
      answers: {
        'q-0': 'Server components execute entirely on the server and do not ship JavaScript to the browser, which improves initial load speed and SEO. Client components are hydrated in the browser and support user interactions like click hooks (useState, useEffect). I use Server Components by default and Client Components only for components that require browser events.',
        'q-1': 'In Prisma, we write model definitions in schema.prisma. During development, we apply changes using npx prisma migrate dev which generates migration scripts and applies them to our dev database. In production, we run npx prisma migrate deploy to execute those scripts safely without running dev-only shadow database processes.',
        'q-2': 'I use Zod schemas to validate request bodies on entry to prevent corrupt payloads. For security, I check auth sessions via cookies/tokens, add custom global rate limiters, and use database parameterized queries (which Prisma does natively) to avoid SQL injection attacks.',
      },
      score: 8.8,
      percentage: 88.0,
      evaluationData: {
        overallFeedback:
          'Alice has demonstrated an excellent conceptual understanding of both backend and frontend design models. Her explanation of Next.js hydration boundaries is highly accurate. She correctly detailed safe database deployment steps and schema validation. Highly recommended for final rounds.',
        topicScores: {
          'System Architecture': 9.0,
          'Database & ORMs': 8.5,
          'API Implementation': 9.0,
        },
        skillScores: {
          TypeScript: 90,
          'Next.js': 90,
          Prisma: 85,
          PostgreSQL: 85,
          Security: 90,
        },
        answersEvaluation: {
          'q-0': {
            score: 9.0,
            feedback: 'Excellent critique. Accurate explanation of server-side bundle size benefits and hydration concepts.',
          },
          'q-1': {
            score: 8.5,
            feedback: 'Highly accurate description of production migrate deploy operations. Good database structure awareness.',
          },
          'q-2': {
            score: 9.0,
            feedback: 'Strong secure API suggestions. Specifically, Zod validation and SQL injection defense mechanisms are well outlined.',
          },
        },
      },
    },
  });

  // Bob Assessment
  await prisma.assessment.create({
    data: {
      candidateId: c2.id,
      jobId: job2.id,
      questions: selectedQuestionsForBob,
      assignedQuestionIds: selectedQuestionsForBob.map(q => q.id),
      answers: {
        'q-0': 'Connection pooling maintains a queue of open database connections. When a request comes in, it borrows an active connection instead of performing the TCP handshake to open a new one. In serverless environments (like Vercel functions), instances spin up and down dynamically. This can easily exhaust connection limits of databases (like Postgres) if each function opens direct connections.',
        'q-1': 'I wrap API blocks in try-catch logic, validate inputs using schemas, and verify bearer tokens in the authorization header.',
      },
      completedAt: new Date(),
    },
  });

  console.log('Seeded Completed Assessments successfully.');

  // 6. Seed mock JD descriptions in job_descriptions table for test & duplicate detection
  const crypto = require('crypto');
  const jdText1 = 'Job Code: J001\nFull Stack Engineer responsible for database systems and React web apps.';
  const hash1 = crypto.createHash('sha256').update(jdText1).digest('hex');
  await pool.query(`
    INSERT INTO job_descriptions (content_hash, job_code, job_title, jd_text, status)
    VALUES ($1, $2, $3, $4, 'Active')
    ON CONFLICT (content_hash) DO NOTHING;
  `, [hash1, 'J001', 'Full Stack Engineer', jdText1]);
  console.log('Seeded Mock Job Descriptions for Duplicate Detection Test.');

  console.log('Seeding finished successfully.');
  pool.end();
}

main().catch((err) => {
  console.error('Error during database seed execution:', err);
  pool.end();
  process.exit(1);
});
