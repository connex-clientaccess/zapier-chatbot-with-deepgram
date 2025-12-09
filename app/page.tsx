'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Loader2, MessageCircle, Shield } from 'lucide-react';

export default function VoiceChat() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<Array<{role: string; text: string; isTyping?: boolean}>>([]);
  const [status, setStatus] = useState('');
  const [threadId, setThreadId] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recordingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Faster polling - check every 1 second instead of 2
  useEffect(() => {
    if (!threadId) return;

    const pollingInterval = setInterval(async () => {
      if (isSpeaking) return;
      
      try {
        const response = await fetch(`/api/bot-message/${threadId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.message) {
            // Remove typing indicator
            setMessages(prev => prev.filter(m => !m.isTyping));
            // Add actual message
            setMessages(prev => [...prev, { role: 'bot', text: data.message }]);
            await speakText(data.message);
          }
        }
      } catch (error) {
        // Silently fail
      }
    }, 1000); // Reduced from 2000ms to 1000ms

    return () => {
      clearInterval(pollingInterval);
    };
  }, [threadId, isSpeaking]);

  function generateThreadId() {
    return 'thread_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async function startNewConversation() {
    const newThreadId = generateThreadId();
    setThreadId(newThreadId);
    setMessages([]);
    setStatus('Connecting...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (error) {
      console.warn('Microphone not available:', error);
    }

    try {
      await fetch('/api/conversation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: newThreadId })
      });
      
      // Show typing indicator while waiting for initial greeting
      setMessages([{ role: 'bot', text: '', isTyping: true }]);
      setStatus('');
    } catch (error) {
      console.error('Error starting conversation:', error);
      setStatus('');
    }
  }

  async function handleTextSend() {
    if (!textInput.trim() || !threadId || isProcessing) return;

    const userMessage = textInput.trim();
    setTextInput('');
    
    // Immediately show user message
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    
    // Show typing indicator for bot response
    setMessages(prev => [...prev, { role: 'bot', text: '', isTyping: true }]);
    
    setIsProcessing(true);

    try {
      await fetch('/api/message/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, message: userMessage })
      });
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove typing indicator on error
      setMessages(prev => prev.filter(m => !m.isTyping));
    } finally {
      setIsProcessing(false);
    }
  }

  async function toggleRecording() {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  async function startRecording() {
    if (!streamRef.current || !threadId) {
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
    setStatus('🎤 Listening...');
    
    // Auto-stop after 8 seconds
    recordingTimeoutRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        stopRecording();
      }
    }, 8000);
  }

  function stopRecording() {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
    }
    
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsListening(false);
      setStatus('⏳ Processing...');
    }
  }

  async function transcribeAudio(audioBlob: Blob) {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      const transcript = result.transcript;

      if (transcript && transcript.trim()) {
        // Immediately show user message
        setMessages(prev => [...prev, { role: 'user', text: transcript }]);
        
        // Show typing indicator for bot response
        setMessages(prev => [...prev, { role: 'bot', text: '', isTyping: true }]);
        
        await fetch('/api/message/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId, message: transcript })
        });
        
        setStatus('');
      } else {
        setStatus('❌ No speech detected');
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (error) {
      console.error('Transcription error:', error);
      setStatus('❌ Error processing voice');
      setTimeout(() => setStatus(''), 2000);
    }
  }

  async function speakText(text: string) {
    try {
      setIsSpeaking(true);
      setStatus('🔊 Bot speaking...');

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
        setStatus('');
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
      
    } catch (error) {
      console.error('TTS error:', error);
      setIsSpeaking(false);
      setStatus('');
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
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '0',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
        
        {/* Header - Mobile Optimized */}
        <div style={{ 
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          padding: '16px 20px',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          boxShadow: '0 2px 20px rgba(0,0,0,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Bot Avatar */}
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
                Bot
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Shield size={14} style={{ color: '#667eea' }} />
                <p style={{ 
                  margin: 0, 
                  color: '#666', 
                  fontSize: '13px',
                  fontWeight: '500'
                }}>
                  Zapier Chatbot with Deepgram
                </p>
              </div>
            </div>
            {threadId && (
              <button
                onClick={startNewConversation}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: '600',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)',
                  transition: 'all 0.2s',
                  flexShrink: 0
                }}
              >
                New Chat
              </button>
            )}
          </div>
        </div>

        {/* Start Screen */}
        {!threadId && (
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
              maxWidth: '400px',
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
                Welcome!
              </h2>
              <p style={{ fontSize: '15px', color: '#666', marginBottom: '25px', lineHeight: '1.6' }}>
                I'm ZapBot
              </p>
              <button
                onClick={startNewConversation}
                style={{
                  padding: '16px 36px',
                  fontSize: '16px',
                  fontWeight: '600',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  boxShadow: '0 6px 20px rgba(102, 126, 234, 0.4)',
                  transition: 'all 0.2s'
                }}
              >
                <MessageCircle size={20} />
                Start Conversation
              </button>
            </div>
          </div>
        )}

        {threadId && (
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

            {/* Messages Area - Mobile Optimized */}
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
                    display: 'inline-block',
                    padding: '20px',
                    color: '#9ca3af',
                    fontSize: '14px'
                  }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      border: '4px solid #e5e7eb',
                      borderTop: '4px solid #667eea',
                      borderRadius: '50%',
                      margin: '0 auto 15px',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    Connecting with Bot...
                  </div>
                  <style>{`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}</style>
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
                          padding: msg.isTyping ? '14px 18px' : '12px 16px',
                          borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          backgroundColor: msg.role === 'user' ? '#667eea' : '#ffffff',
                          color: msg.role === 'user' ? '#ffffff' : '#1a1a1a',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontSize: '14px',
                          lineHeight: '1.5',
                          wordBreak: 'break-word'
                        }}
                      >
                        {msg.isTyping ? (
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <div style={{ 
                              width: '8px', 
                              height: '8px', 
                              borderRadius: '50%', 
                              backgroundColor: '#667eea',
                              animation: 'bounce 1.4s infinite ease-in-out'
                            }}></div>
                            <div style={{ 
                              width: '8px', 
                              height: '8px', 
                              borderRadius: '50%', 
                              backgroundColor: '#667eea',
                              animation: 'bounce 1.4s infinite ease-in-out 0.2s'
                            }}></div>
                            <div style={{ 
                              width: '8px', 
                              height: '8px', 
                              borderRadius: '50%', 
                              backgroundColor: '#667eea',
                              animation: 'bounce 1.4s infinite ease-in-out 0.4s'
                            }}></div>
                            <style>{`
                              @keyframes bounce {
                                0%, 60%, 100% { transform: translateY(0); }
                                30% { transform: translateY(-10px); }
                              }
                            `}</style>
                          </div>
                        ) : (
                          msg.text
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input Area - Mobile Optimized */}
            <div style={{ 
              padding: '16px',
              backgroundColor: 'white',
              borderTop: '1px solid rgba(0,0,0,0.05)',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.05)'
            }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type here..."
                  disabled={isSpeaking || isProcessing}
                  style={{
                    flex: 1,
                    padding: '12px 14px',
                    fontSize: '14px',
                    borderRadius: '10px',
                    border: '2px solid #e5e7eb',
                    outline: 'none',
                    backgroundColor: '#fafafa',
                    color: '#1a1a1a',
                    minWidth: 0
                  }}
                />

                <button
                  onClick={handleTextSend}
                  disabled={!textInput.trim() || isSpeaking || isProcessing}
                  style={{
                    padding: '12px 16px',
                    fontSize: '14px',
                    fontWeight: '600',
                    borderRadius: '10px',
                    border: 'none',
                    background: (!textInput.trim() || isSpeaking || isProcessing) 
                      ? '#e5e7eb' 
                      : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    cursor: (!textInput.trim() || isSpeaking || isProcessing) ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexShrink: 0
                  }}
                >
                  <Send size={16} />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    toggleRecording();
                  }}
                  disabled={isSpeaking || isProcessing}
                  style={{
                    padding: '12px 16px',
                    fontSize: '14px',
                    fontWeight: '600',
                    borderRadius: '10px',
                    border: 'none',
                    background: isListening 
                      ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                      : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: 'white',
                    cursor: (isSpeaking || isProcessing) ? 'not-allowed' : 'pointer',
                    opacity: (isSpeaking || isProcessing) ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexShrink: 0
                  }}
                >
                  {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}