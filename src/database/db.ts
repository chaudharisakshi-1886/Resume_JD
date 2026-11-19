import '../utils/dns-fix';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = globalThis as unknown as {
  prisma?: ExtendedPrismaClient;
  pool?: Pool;
};

export const pool =
  globalForPrisma.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_URL &&
      !process.env.DATABASE_URL.includes('localhost') &&
      !process.env.DATABASE_URL.includes('127.0.0.1')
        ? { rejectUnauthorized: false }
        : undefined,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 60000,
    max: 20,
    keepAlive: true,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pool = pool;
}

const adapter = new PrismaPg(pool);

function safeParseArray<T = string>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
      if (parsed) return [parsed as T];
    } catch {
      return val.trim() ? [val.trim() as unknown as T] : [];
    }
  }
  return [];
}

function safeParseObject(val: any): Record<string, any> {
  if (!val) return {};
  if (typeof val === 'object' && !Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

const createPrismaClient = () => {
  const basePrisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  return basePrisma.$extends({
    result: {
      candidate: {
        name: {
          needs: { fname: true, lname: true },
          compute(c) {
            return `${c.fname} ${c.lname}`.trim();
          },
        },
      },
      job: {
        parsedJDData: {
          needs: {
            skills: true,
            mustHave: true,
            goodToHave: true,
            experience: true,
            seniority: true,
            topics: true,
            weights: true,
          },
          compute(j) {
            return {
              skills: safeParseArray(j.skills),
              mustHave: safeParseArray(j.mustHave),
              goodToHave: safeParseArray(j.goodToHave),
              experience: typeof j.experience === 'string' ? j.experience : '',
              seniority: typeof j.seniority === 'string' ? j.seniority : '',
              topics: safeParseArray(j.topics),
              weights: safeParseObject(j.weights),
            };
          },
        },
      },
    },
  });
};

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
