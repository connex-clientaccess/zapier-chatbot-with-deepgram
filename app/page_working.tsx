'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Send, MessageCircle, Shield } from 'lucide-react';

export default function VoiceChat() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<Array<{role: string; text: string}>>([]);
  const [status, setStatus] = useState('');
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
    if (!threadId) return;

    const pollingInterval = setInterval(async () => {
      if (isSpeaking) return;
      
      try {
        const response = await fetch(`/api/bot-message/${threadId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.message) {
            setMessages(prev => [...prev, { role: 'bot', text: data.message }]);
            await speakText(data.message);
          }
        }
      } catch (error) {
        // Silently fail
      }
    }, 2000);

    return () => {
      clearInterval(pollingInterval);
    };
  }, [threadId]);

  function generateThreadId() {
    return 'thread_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async function startNewConversation() {
    const newThreadId = generateThreadId();
    setThreadId(newThreadId);
    setMessages([]);
    setStatus('Waiting for Aleena...');

    try {
      await fetch('/api/conversation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: newThreadId })
      });
      // Bot will send initial greeting via webhook
    } catch (error) {
      console.error('Error starting conversation:', error);
      setStatus('');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch (error) {
      console.warn('Microphone not available:', error);
    }
  }

  async function handleTextSend() {
    if (!textInput.trim() || !threadId || isProcessing) return;

    const userMessage = textInput.trim();
    setTextInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsProcessing(true);
    setStatus('Sending...');

    try {
      await fetch('/api/message/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, message: userMessage })
      });
      setStatus('');
    } catch (error) {
      console.error('Error sending message:', error);
      setStatus('');
    } finally {
      setIsProcessing(false);
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
    setStatus('Listening...');
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
      setStatus('Processing your message...');
      
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
        
        await fetch('/api/message/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId, message: transcript })
        });
        
        setStatus('');
      } else {
        setStatus('Could not understand. Please try again.');
        setTimeout(() => setStatus(''), 2000);
      }
    } catch (error) {
      console.error('Transcription error:', error);
      setStatus('Error processing voice. Please try again.');
      setTimeout(() => setStatus(''), 2000);
    }
  }

  async function speakText(text: string) {
    try {
      setIsSpeaking(true);
      setStatus('Aleena is speaking...');

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

  function handleMouseDown() {
    startRecording();
  }

  function handleMouseUp() {
    stopRecording();
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
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        
        {/* Header */}
        <div style={{ 
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          padding: '20px 30px',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
          boxShadow: '0 2px 20px rgba(0,0,0,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {/* Aleena Avatar */}
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="8" r="4" fill="white" opacity="0.9"/>
                <path d="M4 20C4 16.6863 6.68629 14 10 14H14C17.3137 14 20 16.6863 20 20V21H4V20Z" fill="white" opacity="0.9"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ 
                margin: '0 0 4px 0', 
                fontSize: '24px',
                color: '#1a1a1a',
                fontWeight: '700'
              }}>
                Aleena
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={16} style={{ color: '#667eea' }} />
                <p style={{ 
                  margin: 0, 
                  color: '#666', 
                  fontSize: '14px',
                  fontWeight: '500'
                }}>
                  Home & Auto Insurance Specialist
                </p>
              </div>
            </div>
            {threadId && (
              <button
                onClick={startNewConversation}
                style={{
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: '600',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
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
            padding: '40px'
          }}>
            <div style={{
              textAlign: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              padding: '60px 40px',
              borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
              maxWidth: '500px'
            }}>
              <div style={{
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 30px',
                boxShadow: '0 10px 30px rgba(102, 126, 234, 0.4)'
              }}>
                <MessageCircle size={50} color="white" />
              </div>
              <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#1a1a1a', marginBottom: '15px' }}>
                Welcome!
              </h2>
              <p style={{ fontSize: '16px', color: '#666', marginBottom: '30px', lineHeight: '1.6' }}>
                I'm Aleena, your insurance assistant. I can help you find the perfect home and auto insurance package tailored to your needs.
              </p>
              <button
                onClick={startNewConversation}
                style={{
                  padding: '18px 40px',
                  fontSize: '18px',
                  fontWeight: '600',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '12px',
                  boxShadow: '0 6px 20px rgba(102, 126, 234, 0.4)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.5)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
                }}
              >
                <MessageCircle size={24} />
                Start Conversation
              </button>
            </div>
          </div>
        )}

        {threadId && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#f8f9fa' }}>
            
            {/* Status Bar */}
            {status && (
              <div style={{
                padding: '12px 30px',
                backgroundColor: isListening ? '#dbeafe' : isSpeaking ? '#fef3c7' : '#f0fdf4',
                borderBottom: '1px solid rgba(0,0,0,0.05)',
                textAlign: 'center',
                fontSize: '14px',
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
              padding: '30px',
              backgroundColor: '#f8f9fa'
            }}>
              {messages.length === 0 ? (
                <div style={{ 
                  textAlign: 'center',
                  paddingTop: '150px'
                }}>
                  <div style={{
                    display: 'inline-block',
                    padding: '30px',
                    color: '#9ca3af',
                    fontSize: '15px'
                  }}>
                    <div style={{
                      width: '50px',
                      height: '50px',
                      border: '4px solid #e5e7eb',
                      borderTop: '4px solid #667eea',
                      borderRadius: '50%',
                      margin: '0 auto 20px',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    Connecting with Aleena...
                  </div>
                  <style>{`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: '20px',
                      display: 'flex',
                      justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      alignItems: 'flex-start',
                      gap: '12px'
                    }}
                  >
                    {msg.role === 'bot' && (
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="12" cy="8" r="3" fill="white" opacity="0.9"/>
                          <path d="M6 20C6 17.2386 8.23858 15 11 15H13C15.7614 15 18 17.2386 18 20V21H6V20Z" fill="white" opacity="0.9"/>
                        </svg>
                      </div>
                    )}
                    <div
                      style={{
                        maxWidth: '65%',
                        padding: '14px 18px',
                        borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        backgroundColor: msg.role === 'user' ? '#667eea' : '#ffffff',
                        color: msg.role === 'user' ? '#ffffff' : '#1a1a1a',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        fontSize: '15px',
                        lineHeight: '1.5',
                        wordBreak: 'break-word'
                      }}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input Area */}
            <div style={{ 
              padding: '20px 30px 25px',
              backgroundColor: 'white',
              borderTop: '1px solid rgba(0,0,0,0.05)',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.05)'
            }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your message..."
                  disabled={isSpeaking || isProcessing}
                  style={{
                    flex: 1,
                    padding: '14px 18px',
                    fontSize: '15px',
                    borderRadius: '12px',
                    border: '2px solid #e5e7eb',
                    outline: 'none',
                    backgroundColor: '#fafafa',
                    color: '#1a1a1a',
                    transition: 'all 0.2s'
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#667eea';
                    e.currentTarget.style.backgroundColor = 'white';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.backgroundColor = '#fafafa';
                  }}
                />

                <button
                  onClick={handleTextSend}
                  disabled={!textInput.trim() || isSpeaking || isProcessing}
                  style={{
                    padding: '14px 24px',
                    fontSize: '15px',
                    fontWeight: '600',
                    borderRadius: '12px',
                    border: 'none',
                    background: (!textInput.trim() || isSpeaking || isProcessing) 
                      ? '#e5e7eb' 
                      : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    cursor: (!textInput.trim() || isSpeaking || isProcessing) ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s',
                    boxShadow: (!textInput.trim() || isSpeaking || isProcessing) 
                      ? 'none' 
                      : '0 4px 12px rgba(102, 126, 234, 0.3)'
                  }}
                  onMouseOver={(e) => {
                    if (!(!textInput.trim() || isSpeaking || isProcessing)) {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.4)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!(!textInput.trim() || isSpeaking || isProcessing)) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)';
                    }
                  }}
                >
                  <Send size={18} />
                  Send
                </button>

                <button
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onTouchStart={handleMouseDown}
                  onTouchEnd={handleMouseUp}
                  disabled={isSpeaking || isProcessing}
                  style={{
                    padding: '14px 24px',
                    fontSize: '15px',
                    fontWeight: '600',
                    borderRadius: '12px',
                    border: 'none',
                    background: isListening 
                      ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                      : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: 'white',
                    cursor: (isSpeaking || isProcessing) ? 'not-allowed' : 'pointer',
                    opacity: (isSpeaking || isProcessing) ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s',
                    boxShadow: (isSpeaking || isProcessing) 
                      ? 'none' 
                      : isListening 
                        ? '0 4px 12px rgba(239, 68, 68, 0.4)' 
                        : '0 4px 12px rgba(16, 185, 129, 0.3)',
                    userSelect: 'none'
                  }}
                  onMouseOver={(e) => {
                    if (!(isSpeaking || isProcessing)) {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!(isSpeaking || isProcessing)) {
                      e.currentTarget.style.transform = 'translateY(0)';
                    }
                  }}
                >
                  <Mic size={18} />
                  {isListening ? 'Release to Send' : 'Push to Talk'}
                </button>
              </div>
              <p style={{
                margin: '12px 0 0 0',
                fontSize: '13px',
                color: '#9ca3af',
                textAlign: 'center'
              }}>
                Hold the microphone button to speak, release to send
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}