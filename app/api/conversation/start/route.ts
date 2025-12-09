import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { threadId } = await request.json();
    const webhookUrl = process.env.BOT_WEBHOOK_URL;
    const callbackUrl = process.env.CALLBACK_URL;

    if (!webhookUrl) {
      console.warn('⚠️ BOT_WEBHOOK_URL not configured');
      return NextResponse.json({ success: true, note: 'Webhook not configured' });
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'conversation.started',
        threadId,
        callbackUrl, // Tell bot where to respond
        timestamp: new Date().toISOString()
      })
    });

    console.log('🚀 New conversation started:', threadId);

    return NextResponse.json({ success: true, threadId });
  } catch (error) {
    console.error('❌ Error starting conversation:', error);
    return NextResponse.json({ error: 'Failed to start conversation' }, { status: 500 });
  }
}