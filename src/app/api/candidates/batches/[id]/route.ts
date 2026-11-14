import '@/utils/dns-fix';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/auth';
import { getBatchById } from '@/services/batchService';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 });
    }

    const { batch, unauthorized } = await getBatchById(id, user.id);

    if (unauthorized) {
      return NextResponse.json(
        { error: 'You are not authorized to view this batch.' },
        { status: 403 }
      );
    }

    if (!batch) {
      return NextResponse.json(
        { error: `Batch "${id}" not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json(batch, { status: 200 });
  } catch (error: any) {
    console.error('Error fetching candidate batch status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve batch status.' },
      { status: 500 }
    );
  }
}

