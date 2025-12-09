import { NextRequest, NextResponse } from 'next/server';
import { messageStore } from '@/lib/messageStore';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const { threadId } = await params;
    
    console.log('🔍 Polling for threadId:', threadId);
    console.log('📦 MessageStore size:', messageStore.size);
    console.log('📦 MessageStore keys:', Array.from(messageStore.keys()));
    
    const stored = messageStore.get(threadId);
    
    console.log('📦 Stored message:', stored);

    if (stored && !stored.consumed) {
      stored.consumed = true;
      
      console.log('✅ Delivering bot message to frontend:', threadId, stored.message);
      
      return NextResponse.json({
        message: stored.message,
        timestamp: stored.timestamp
      });
    }

    console.log('❌ No message found for:', threadId);
    return NextResponse.json({ message: null }, { status: 404 });

  } catch (error) {
    console.error('❌ Error fetching bot message:', error);
    return NextResponse.json(
      { error: 'Failed to fetch message' },
      { status: 500 }
    );
  }
}