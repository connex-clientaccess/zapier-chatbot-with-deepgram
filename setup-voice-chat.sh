#!/bin/bash

# Voice Chat Setup Script
# This script creates all necessary files and folders for the voice chat application

set -e  # Exit on error

echo "🚀 Setting up Voice Chat Application..."
echo ""

# Create directory structure
echo "📁 Creating directory structure..."
mkdir -p lib
mkdir -p app/api/conversation/start
mkdir -p app/api/transcribe
mkdir -p app/api/speak
mkdir -p app/api/message/send
mkdir -p app/api/bot-message/[threadId]

# Create lib/messageStore.ts
echo "📝 Creating lib/messageStore.ts..."
cat > lib/messageStore.ts << 'EOF'
type StoredMessage = {
  message: string;
  timestamp: string;
  consumed: boolean;
};

export const messageStore = new Map<string, StoredMessage>();
EOF

# Create app/page.tsx
echo "📝 Creating app/page.tsx..."
cat > app/page.tsx << 'EOF'
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Loader2, MessageCircle } from 'lucide-react';

export default function VoiceChat() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<Array<{role: string; text: string}>>([]);
  const [status, setStatus] = useState('Click "New Conversation" to start');
  const [threadId, setThreadId] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (threadId) {
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const response = await fetch(`/api/bot-message/${threadId}`);
          if (response.ok) {
            const data = await response.json();
            if (data.message && !isSpeaking) {
              setMessages(prev => [...prev, { role: 'bot', text: data.message }]);
              await speakText(data.message);
            }
          }
        } catch (error) {
          // Silently fail
        }
      }, 2000);

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
      };
    }
  }, [threadId, isSpeaking]);

  function generateThreadId() {
    return 'thread_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async function startNewConversation() {
    const newThreadId = generateThreadId();
    setThreadId(newThreadId);
    setMessages([]);
    setStatus('Conversation started. Type or speak your message.');

    try {
      await fetch('/api/conversation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: newThreadId })
      });
      console.log('🚀 New conversation:', newThreadId);
    } catch (error) {
      console.error('Error starting conversation:', error);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (error) {
      console.warn('Microphone not available:', error);
      setStatus('Conversation started (voice input unavailable)');
    }
  }

  async function handleTextSend() {
    if (!textInput.trim() || !threadId || isProcessing) return;

    const userMessage = textInput.trim();
    setTextInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsProcessing(true);
    setStatus('Sending message...');

    try {
      await fetch('/api/message/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, message: userMessage })
      });
      setStatus('Waiting for response...');
    } catch (error) {
      console.error('Error sending message:', error);
      setStatus('Error sending message');
    } finally {
      setIsProcessing(false);
    }
  }

  async function startRecording() {
    if (!streamRef.current || !threadId) {
      setStatus('Please start a new conversation first');
      return;
    }

    audioChunksRef.current = [];
    
    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: 'audio/webm'
    });
    
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      await transcribeAudio(audioBlob);
    };

    mediaRecorder.start();
    setIsListening(true);
    setStatus('Listening... (recording for 5 seconds)');
    
    setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        stopRecording();
      }
    }, 5000);
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsListening(false);
      setStatus('Processing...');
    }
  }

  async function transcribeAudio(audioBlob: Blob) {
    try {
      setStatus('Transcribing...');
      
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      const transcript = result.transcript;

      if (transcript && transcript.trim()) {
        setMessages(prev => [...prev, { role: 'user', text: transcript }]);
        setStatus('Sending to bot...');
        
        await fetch('/api/message/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId, message: transcript })
        });
        
        setStatus('Waiting for response...');
      } else {
        setStatus('No speech detected. Try again.');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      setStatus('Transcription failed. Try again.');
    }
  }

  async function speakText(text: string) {
    try {
      setIsSpeaking(true);
      setStatus('Bot speaking...');

      const response = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audio.onended = () => {
        setIsSpeaking(false);
        setStatus('Ready. Type or speak your message.');
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
      
    } catch (error) {
      console.error('TTS error:', error);
      setIsSpeaking(false);
      setStatus('Error playing audio');
    }
  }

  function handleMicClick() {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSend();
    }
  }

  return (
    <div style={{ 
      maxWidth: '800px', 
      margin: '0 auto', 
      padding: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: '10px' }}>Voice + Text Chat</h2>
      <p style={{ textAlign: 'center', color: '#666', fontSize: '14px', marginBottom: '20px' }}>
        Powered by Deepgram
      </p>

      {!threadId && (
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <button
            onClick={startNewConversation}
            style={{
              padding: '15px 30px',
              fontSize: '16px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#4caf50',
              color: 'white',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <MessageCircle size={20} />
            Start New Conversation
          </button>
        </div>
      )}

      {threadId && (
        <>
          <div style={{
            padding: '10px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            marginBottom: '10px',
            fontSize: '12px',
            textAlign: 'center'
          }}>
            <strong>Thread ID:</strong> <code>{threadId}</code>
            <button
              onClick={startNewConversation}
              style={{
                marginLeft: '15px',
                padding: '5px 10px',
                fontSize: '12px',
                borderRadius: '4px',
                border: '1px solid #ddd',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
            >
              New Conversation
            </button>
          </div>

          <div style={{
            padding: '10px',
            backgroundColor: '#e3f2fd',
            borderRadius: '4px',
            marginBottom: '20px',
            textAlign: 'center',
            fontSize: '14px'
          }}>
            {status}
          </div>

          <div style={{
            height: '400px',
            overflowY: 'auto',
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '15px',
            marginBottom: '20px',
            backgroundColor: 'white'
          }}>
            {messages.length === 0 ? (
              <div style={{ color: '#999', textAlign: 'center', paddingTop: '100px' }}>
                No messages yet. Start typing or speaking!
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: '15px',
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: msg.role === 'user' ? '#e3f2fd' : '#f5f5f5',
                    marginLeft: msg.role === 'user' ? '40px' : '0',
                    marginRight: msg.role === 'user' ? '0' : '40px'
                  }}
                >
                  <div style={{ 
                    fontSize: '12px', 
                    fontWeight: 'bold', 
                    marginBottom: '5px',
                    color: msg.role === 'user' ? '#1976d2' : '#666'
                  }}>
                    {msg.role === 'user' ? 'You' : 'Bot'}
                  </div>
                  <div style={{ fontSize: '14px', lineHeight: '1.5' }}>{msg.text}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ 
            display: 'flex', 
            gap: '10px',
            alignItems: 'flex-end'
          }}>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message here..."
              disabled={isSpeaking || isProcessing}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '14px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                outline: 'none'
              }}
            />

            <button
              onClick={handleTextSend}
              disabled={!textInput.trim() || isSpeaking || isProcessing}
              style={{
                padding: '12px 20px',
                fontSize: '14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: (!textInput.trim() || isSpeaking || isProcessing) ? '#ccc' : '#2196f3',
                color: 'white',
                cursor: (!textInput.trim() || isSpeaking || isProcessing) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <Send size={16} />
              Send
            </button>

            <button
              onClick={handleMicClick}
              disabled={isSpeaking || isProcessing}
              style={{
                padding: '12px 20px',
                fontSize: '14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isListening ? '#f44336' : '#4caf50',
                color: 'white',
                cursor: (isSpeaking || isProcessing) ? 'not-allowed' : 'pointer',
                opacity: (isSpeaking || isProcessing) ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              {isSpeaking ? (
                <><Loader2 size={16} /> Speaking</>
              ) : isListening ? (
                <><MicOff size={16} /> Stop</>
              ) : (
                <><Mic size={16} /> Voice</>
              )}
            </button>
          </div>
        </>
      )}

      <div style={{
        marginTop: '30px',
        padding: '20px',
        backgroundColor: '#fff3cd',
        borderRadius: '8px',
        fontSize: '13px',
        lineHeight: '1.8'
      }}>
        <strong>How it works:</strong>
        <ol style={{ marginTop: '10px', paddingLeft: '20px' }}>
          <li>Click "Start New Conversation" - generates a thread ID and notifies your bot</li>
          <li>Type a message OR click "Voice" to speak</li>
          <li>Message sent to your bot webhook with thread ID</li>
          <li>Your bot responds by POSTing to: <code>/api/bot-message</code></li>
          <li>Response automatically converted to speech and played</li>
        </ol>
      </div>
    </div>
  );
}
EOF

# Create app/api/conversation/start/route.ts
echo "📝 Creating app/api/conversation/start/route.ts..."
cat > app/api/conversation/start/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { threadId } = await request.json();
    const webhookUrl = process.env.BOT_WEBHOOK_URL;

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
EOF

# Create app/api/transcribe/route.ts
echo "📝 Creating app/api/transcribe/route.ts..."
cat > app/api/transcribe/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as Blob;
    
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Deepgram API key not configured' }, { status: 500 });
    }

    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'audio/webm'
      },
      body: audioFile
    });

    const result = await response.json();
    const transcript = result.results?.channels[0]?.alternatives[0]?.transcript;

    return NextResponse.json({ transcript: transcript || '' });
  } catch (error) {
    console.error('❌ Transcription error:', error);
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 });
  }
}
EOF

# Create app/api/speak/route.ts
echo "📝 Creating app/api/speak/route.ts..."
cat > app/api/speak/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();
    
    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Deepgram API key not configured' }, { status: 500 });
    }

    const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    const audioBuffer = await response.arrayBuffer();
    
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString()
      }
    });
  } catch (error) {
    console.error('❌ TTS error:', error);
    return NextResponse.json({ error: 'Text-to-speech failed' }, { status: 500 });
  }
}
EOF

# Create app/api/message/send/route.ts
echo "📝 Creating app/api/message/send/route.ts..."
cat > app/api/message/send/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { threadId, message } = await request.json();
    const webhookUrl = process.env.BOT_WEBHOOK_URL;

    if (!webhookUrl) {
      return NextResponse.json({ error: 'Bot webhook not configured' }, { status: 500 });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        message,
        timestamp: new Date().toISOString()
      })
    });

    console.log('📤 Sent to bot webhook:', { threadId, message });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
EOF

# Create app/api/bot-message/route.ts
echo "📝 Creating app/api/bot-message/route.ts..."
cat > app/api/bot-message/route.ts << 'EOF'
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

    setTimeout(() => {
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
EOF

# Create app/api/bot-message/[threadId]/route.ts
echo "📝 Creating app/api/bot-message/[threadId]/route.ts..."
cat > app/api/bot-message/[threadId]/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server';
import { messageStore } from '@/lib/messageStore';

export async function GET(
  request: NextRequest,
  { params }: { params: { threadId: string } }
) {
  try {
    const { threadId } = params;
    const stored = messageStore.get(threadId);

    if (stored && !stored.consumed) {
      stored.consumed = true;
      
      console.log('✅ Delivering bot message to frontend:', threadId);
      
      return NextResponse.json({
        message: stored.message,
        timestamp: stored.timestamp
      });
    }

    return NextResponse.json({ message: null }, { status: 404 });

  } catch (error) {
    console.error('❌ Error fetching bot message:', error);
    return NextResponse.json(
      { error: 'Failed to fetch message' },
      { status: 500 }
    );
  }
}
EOF

# Create next.config.ts
echo "📝 Creating next.config.ts..."
cat > next.config.ts << 'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
};

export default nextConfig;
EOF

# Create .env.local template
echo "📝 Creating .env.local template..."
cat > .env.local << 'EOF'
# Deepgram API Key - Get from https://console.deepgram.com/
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Your bot webhook URL (receives user messages and conversation events)
BOT_WEBHOOK_URL=https://your-bot-webhook-url.com/process
EOF

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Edit .env.local and add your Deepgram API key"
echo "2. Edit .env.local and add your bot webhook URL"
echo "3. Run: npm install lucide-react"
echo "4. Run: npm run dev"
echo "5. Visit: http://localhost:3000"
echo ""
echo "🎉 Your voice chat application is ready!"
EOF

echo "✅ Setup script created successfully!"
echo ""
echo "Run with: bash setup-voice-chat.sh"