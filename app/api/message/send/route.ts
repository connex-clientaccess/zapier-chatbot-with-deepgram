import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { threadId, message } = await request.json();
    const webhookUrl = process.env.BOT_WEBHOOK_URL;
    const callbackUrl = process.env.CALLBACK_URL;

    if (!webhookUrl) {
      return NextResponse.json({ error: 'Bot webhook not configured' }, { status: 500 });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        message,
        callbackUrl, // Tell bot where to respond
        timestamp: new Date().toISOString()
      })
    });

    console.log('📤 Sent to bot webhook:', { threadId, message, callbackUrl });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}