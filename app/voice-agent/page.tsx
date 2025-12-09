'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, MessageCircle, Shield, Loader2 } from 'lucide-react';

export default function VoiceAgentDemo() {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<Array<{role: string; text: string}>>([]);
  const [status, setStatus] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showConfig, setShowConfig] = useState(true);
  
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  async function connect() {
    if (!apiKey) {
      alert('Please enter your Deepgram API key');
      return;
    }

    try {
      setStatus('Connecting to Deepgram Voice Agent...');

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      mediaStreamRef.current = stream;

      // Create audio context
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      // Create processor for sending audio
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      // Connect to Deepgram Voice Agent
      const ws = new WebSocket('wss://agent.deepgram.com/agent', [
        'token',
        apiKey
      ]);

      ws.onopen = () => {
        console.log('✅ Connected to Deepgram Voice Agent');
        setIsConnected(true);
        setShowConfig(false);
        setStatus('🟢 Connected - Click microphone to start');

        // Send configuration
        const config = {
          type: 'SettingsConfiguration',
          audio: {
            input: {
              encoding: 'linear16',
              sample_rate: 16000
            },
            output: {
              encoding: 'linear16',
              sample_rate: 16000,
              container: 'none'
            }
          },
          agent: {
            listen: {
              model: 'nova-2'
            },
            speak: {
              model: 'aura-asteria-en'
            },
            think: {
              provider: {
                type: 'open_ai'
              },
              model: 'gpt-4o',
              instructions: `You are Aleena, a friendly and professional insurance specialist. You help customers with home and auto insurance quotes and information.

Key responsibilities:
- Greet customers warmly
- Ask for their name and basic information
- Discuss their insurance needs (home, auto, or both)
- Provide helpful information about coverage options
- Be conversational and empathetic
- Keep responses concise and clear

Always be professional, friendly, and helpful.`,
              functions: []
            }
          }
        };

        ws.send(JSON.stringify(config));
        console.log('📤 Sent configuration');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 Received:', data.type);

          if (data.type === 'UserStartedSpeaking') {
            console.log('🎤 User started speaking');
            setStatus('🎤 Listening to you...');
          }
          
          if (data.type === 'UserStoppedSpeaking') {
            console.log('🛑 User stopped speaking');
            setStatus('💭 Aleena is thinking...');
          }

          if (data.type === 'ConversationText') {
            console.log('💬 Conversation text:', data);
            
            if (data.role === 'user') {
              setMessages(prev => [...prev, { role: 'user', text: data.content }]);
            } else if (data.role === 'assistant') {
              setMessages(prev => [...prev, { role: 'bot', text: data.content }]);
            }
          }

          if (data.type === 'AgentAudioDone') {
            console.log('🔇 Agent finished speaking');
            setIsSpeaking(false);
            setStatus('🎤 Ready - Your turn to speak');
          }

          if (data.type === 'AgentStartedSpeaking') {
            console.log('🔊 Agent started speaking');
            setIsSpeaking(true);
            setStatus('🔊 Aleena is speaking...');
          }

          // Handle audio data
          if (data.type === 'AudioData') {
            const audioData = atob(data.audio);
            const audioArray = new Uint8Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
              audioArray[i] = audioData.charCodeAt(i);
            }
            
            // Convert to Float32Array
            const float32Array = new Float32Array(audioArray.length / 2);
            const dataView = new DataView(audioArray.buffer);
            for (let i = 0; i < float32Array.length; i++) {
              float32Array[i] = dataView.getInt16(i * 2, true) / 32768.0;
            }
            
            playAudio(float32Array);
          }
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setStatus('❌ Connection error');
      };

      ws.onclose = () => {
        console.log('🔌 Disconnected from Deepgram');
        setIsConnected(false);
        setIsListening(false);
        setStatus('Disconnected');
      };

      wsRef.current = ws;

      // Set up audio processing
      processorRef.current.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN && isListening) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm16 = floatTo16BitPCM(inputData);
          ws.send(pcm16);
        }
      };

      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

    } catch (error) {
      console.error('Connection error:', error);
      setStatus('❌ Failed to connect');
      alert('Failed to connect. Check your API key and microphone permissions.');
    }
  }

  function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function playAudio(audioData: Float32Array) {
    if (!audioContextRef.current) return;
    
    audioQueueRef.current.push(audioData);
    
    if (audioQueueRef.current.length === 1) {
      playNextChunk();
    }
  }

  function playNextChunk() {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current) return;
    
    const audioData = audioQueueRef.current.shift()!;
    const audioBuffer = audioContextRef.current.createBuffer(1, audioData.length, 16000);
    audioBuffer.getChannelData(0).set(audioData);
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => playNextChunk();
    source.start();
  }

  function startListening() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setIsListening(true);
      setStatus('🎤 Listening - Speak now...');
    }
  }

  function stopListening() {
    setIsListening(false);
    setStatus('⏳ Processing...');
  }

  function disconnect() {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsConnected(false);
    setIsListening(false);
    setMessages([]);
    setShowConfig(true);
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{ 
        maxWidth: '100%', 
        margin: '0 auto', 
        minHeight: '100vh', 
        display: 'flex', 
        flexDirection: 'column',
        width: '100%'
      }}>
        
        {/* Header */}
        <div style={{ 
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          padding: '16px 20px',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          boxShadow: '0 2px 20px rgba(0,0,0,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
              flexShrink: 0
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="8" r="4" fill="white" opacity="0.9"/>
                <path d="M4 20C4 16.6863 6.68629 14 10 14H14C17.3137 14 20 16.6863 20 20V21H4V20Z" fill="white" opacity="0.9"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <h1 style={{ 
                margin: '0 0 2px 0', 
                fontSize: '20px',
                color: '#1a1a1a',
                fontWeight: '700'
              }}>
                Aleena <span style={{ fontSize: '12px', color: '#667eea', fontWeight: '600' }}>VOICE AGENT</span>
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Shield size={14} style={{ color: '#667eea' }} />
                <p style={{ 
                  margin: 0, 
                  color: '#666', 
                  fontSize: '13px',
                  fontWeight: '500'
                }}>
                  Real-time Voice Assistant
                </p>
              </div>
            </div>
            {isConnected && (
              <button
                onClick={disconnect}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: '600',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#ef4444',
                  color: 'white',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {/* Config Screen */}
        {showConfig && (
          <div style={{ 
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}>
            <div style={{
              textAlign: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              padding: '40px 30px',
              borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
              maxWidth: '500px',
              width: '100%'
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 25px',
                boxShadow: '0 10px 30px rgba(102, 126, 234, 0.4)'
              }}>
                <MessageCircle size={40} color="white" />
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#1a1a1a', marginBottom: '12px' }}>
                Deepgram Voice Agent Demo
              </h2>
              <p style={{ fontSize: '14px', color: '#666', marginBottom: '25px', lineHeight: '1.6' }}>
                Real-time voice conversation with ultra-low latency using Deepgram's Voice Agent API.
              </p>
              
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter Deepgram API Key"
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: '14px',
                  borderRadius: '10px',
                  border: '2px solid #e5e7eb',
                  marginBottom: '20px',
                  outline: 'none'
                }}
              />
              
              <button
                onClick={connect}
                disabled={!apiKey}
                style={{
                  padding: '16px 36px',
                  fontSize: '16px',
                  fontWeight: '600',
                  borderRadius: '12px',
                  border: 'none',
                  background: apiKey ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#e5e7eb',
                  color: 'white',
                  cursor: apiKey ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  boxShadow: apiKey ? '0 6px 20px rgba(102, 126, 234, 0.4)' : 'none',
                  width: '100%',
                  justifyContent: 'center'
                }}
              >
                <MessageCircle size={20} />
                Connect to Voice Agent
              </button>
              
              <div style={{ 
                marginTop: '20px', 
                padding: '15px', 
                backgroundColor: '#fef3c7',
                borderRadius: '8px',
                fontSize: '13px',
                textAlign: 'left',
                lineHeight: '1.6'
              }}>
                <strong>Note:</strong> This uses Deepgram's Voice Agent API which requires OpenAI credits for the LLM. Make sure your Deepgram account has OpenAI configured.
              </div>
            </div>
          </div>
        )}

        {/* Chat Interface */}
        {isConnected && (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            backgroundColor: '#f8f9fa',
            minHeight: 0
          }}>
            
            {/* Status Bar */}
            {status && (
              <div style={{
                padding: '10px 20px',
                backgroundColor: isListening ? '#dbeafe' : isSpeaking ? '#fef3c7' : '#f0fdf4',
                borderBottom: '1px solid rgba(0,0,0,0.05)',
                textAlign: 'center',
                fontSize: '13px',
                fontWeight: '500',
                color: '#1a1a1a'
              }}>
                {status}
              </div>
            )}

            {/* Messages Area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 16px',
              backgroundColor: '#f8f9fa',
              minHeight: 0
            }}>
              {messages.length === 0 ? (
                <div style={{ 
                  textAlign: 'center',
                  paddingTop: '80px'
                }}>
                  <div style={{
                    padding: '20px 30px',
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    display: 'inline-block',
                    color: '#666',
                    fontSize: '14px'
                  }}>
                    🎤 Click the microphone button below to start talking with Aleena
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      style={{
                        marginBottom: '16px',
                        display: 'flex',
                        justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        alignItems: 'flex-start',
                        gap: '10px'
                      }}
                    >
                      {msg.role === 'bot' && (
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="8" r="3" fill="white" opacity="0.9"/>
                            <path d="M6 20C6 17.2386 8.23858 15 11 15H13C15.7614 15 18 17.2386 18 20V21H6V20Z" fill="white" opacity="0.9"/>
                          </svg>
                        </div>
                      )}
                      <div
                        style={{
                          maxWidth: '75%',
                          padding: '12px 16px',
                          borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          backgroundColor: msg.role === 'user' ? '#667eea' : '#ffffff',
                          color: msg.role === 'user' ? '#ffffff' : '#1a1a1a',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontSize: '14px',
                          lineHeight: '1.5',
                          wordBreak: 'break-word'
                        }}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Voice Controls */}
            <div style={{ 
              padding: '30px 20px',
              backgroundColor: 'white',
              borderTop: '1px solid rgba(0,0,0,0.05)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '20px'
            }}>
              <button
                onClick={isListening ? stopListening : startListening}
                disabled={isSpeaking}
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  border: 'none',
                  background: isListening 
                    ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                    : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  cursor: isSpeaking ? 'not-allowed' : 'pointer',
                  opacity: isSpeaking ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: isSpeaking 
                    ? 'none'
                    : isListening 
                      ? '0 8px 24px rgba(239, 68, 68, 0.4)' 
                      : '0 8px 24px rgba(16, 185, 129, 0.4)',
                  transition: 'all 0.2s',
                  transform: isListening ? 'scale(1.1)' : 'scale(1)'
                }}
              >
                {isListening ? <MicOff size={32} /> : <Mic size={32} />}
              </button>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a', marginBottom: '4px' }}>
                  {isListening ? 'Listening...' : 'Push to Talk'}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  {isListening ? 'Click to stop' : 'Click to start speaking'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}