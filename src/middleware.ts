import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Cached JWT Secret for Edge runtime
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || 'e9f8a3c42b1076e5d893fa01928bc5419e7a8362b5d4e1f0c7a8b9e0d1f2a3c4';
  return new TextEncoder().encode(secret);
}

interface JWTPayload {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'RECRUITER';
  [key: string]: any;
}

async function verifyToken(token: string): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { clockTolerance: 30 });
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// Allowed CORS origins
function getAllowedOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin');
  const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS || '';
  const allowedOrigins = allowedOriginsEnv
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);

  if (!origin) return '*';

  const normalizedOrigin = origin.toLowerCase();
  if (
    allowedOrigins.length === 0 ||
    allowedOrigins.includes(normalizedOrigin) ||
    normalizedOrigin.includes('localhost') ||
    normalizedOrigin.includes('127.0.0.1')
  ) {
    return origin;
  }

  return '';
}

function applyCorsHeaders(response: NextResponse, allowedOrigin: string): void {
  if (allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-webhook-secret, x-n8n-secret, x-auth-token, x-secret'
    );
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const allowedOrigin = getAllowedOrigin(request);

  // 1. Handle HTTP OPTIONS preflight for CORS
  if (request.method === 'OPTIONS') {
    const preflight = new NextResponse(null, { status: 204 });
    applyCorsHeaders(preflight, allowedOrigin);
    return preflight;
  }

  // 2. Identify token from headers or cookies
  let token: string | undefined;
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }
  if (!token) {
    token = request.headers.get('x-auth-token') || undefined;
  }
  if (!token) {
    token = request.cookies.get('auth_token')?.value;
  }

  const sessionUser = token ? await verifyToken(token) : null;

  // 3. Define Route Categories
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isDashboardRoute = pathname === '/dashboard' || pathname.startsWith('/dashboard/');
  const isAdminDashboardRoute =
    pathname.startsWith('/dashboard/team') || pathname.startsWith('/dashboard/settings');

  const isPublicApi =
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/assessment/validate') ||
    pathname.startsWith('/api/assessment/book-slot') ||
    pathname.startsWith('/api/assessment/generate') ||
    pathname.startsWith('/api/assessment/submit') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/api/internal/');

  const isAdminApi =
    pathname.startsWith('/api/team') ||
    pathname.startsWith('/api/settings');

  const isProtectedApi = pathname.startsWith('/api/') && !isPublicApi;

  // 4. Redirect logged-in users away from auth pages
  if (isAuthPage && sessionUser) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    const res = NextResponse.redirect(redirectUrl);
    applyCorsHeaders(res, allowedOrigin);
    return res;
  }

  // 5. Enforce Authentication on Dashboard pages
  if (isDashboardRoute) {
    if (!sessionUser) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/login';
      redirectUrl.searchParams.set('redirect', pathname);
      const res = NextResponse.redirect(redirectUrl);
      // Clear invalid auth cookie if present
      res.cookies.delete('auth_token');
      applyCorsHeaders(res, allowedOrigin);
      return res;
    }

    // Role-based route guard for Admin Dashboard pages
    if (isAdminDashboardRoute && sessionUser.role !== 'ADMIN') {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = '/dashboard';
      const res = NextResponse.redirect(redirectUrl);
      applyCorsHeaders(res, allowedOrigin);
      return res;
    }
  }

  // 6. Enforce Authentication on Protected API routes
  if (isProtectedApi) {
    if (!sessionUser) {
      const res = NextResponse.json(
        { error: 'Unauthorized: Valid authentication token required.' },
        { status: 401 }
      );
      applyCorsHeaders(res, allowedOrigin);
      return res;
    }

    // Role-based route guard for Admin APIs
    if (isAdminApi && sessionUser.role !== 'ADMIN') {
      const res = NextResponse.json(
        { error: 'Forbidden: Super Admin access required.' },
        { status: 403 }
      );
      applyCorsHeaders(res, allowedOrigin);
      return res;
    }
  }

  // 7. Attach Verified User details to Request Headers for downstream API handlers
  const requestHeaders = new Headers(request.headers);
  if (sessionUser) {
    requestHeaders.set('x-user-id', sessionUser.id);
    requestHeaders.set('x-user-role', sessionUser.role);
    requestHeaders.set('x-user-email', sessionUser.email);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  applyCorsHeaders(response, allowedOrigin);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
