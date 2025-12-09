import { NextRequest, NextResponse } from 'next/server';
import { messageStore } from '@/lib/messageStore';

export async function POST(request: NextRequest) {
  try {
    const { threadId, message } = await request.json();

    if (!threadId || !message) {
      return NextResponse.json(
        { error: 'threadId and message are required' },
        { status: 400 }
      );
    }

    console.log('📨 Received bot message:', { threadId, message });

    messageStore.set(threadId, {
      message,
      timestamp: new Date().toISOString(),
      consumed: false
    });

    console.log('✅ Stored in messageStore. Current size:', messageStore.size);
    console.log('✅ Verify stored:', messageStore.get(threadId));

    setTimeout(() => {
      console.log('🗑️ Cleaning up message for threadId:', threadId);
      messageStore.delete(threadId);
    }, 30000);

    return NextResponse.json({ 
      success: true,
      threadId,
      message: 'Bot message received and queued for delivery'
    });

  } catch (error) {
    console.error('❌ Error in bot-message endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to process bot message' },
      { status: 500 }
    );
  }
}