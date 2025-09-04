import React, { useState, useRef, useEffect } from "react";
import { Github, Download, Copy, RotateCcw, Play, Square, CheckCircle, XCircle, Loader, Code, FileText, Zap } from "lucide-react";

const BACKEND_URL = "https://readme-666x.onrender.com";

const renderMarkdown = (text) => {
  if (!text) return '';
  
  let html = text
    .replace(/^### (.*$)/gm, '<h3 style="color: #06b6d4; margin: 1.5rem 0 0.5rem 0; font-size: 1.2rem; font-weight: 600;">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 style="color: #fff; margin: 2rem 0 1rem 0; font-size: 1.4rem; font-weight: 700;">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 style="color: #fff; margin: 2rem 0 1rem 0; font-size: 1.6rem; font-weight: 800;">$1</h1>')
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre style="background: #071127; padding: 1rem; border-radius: 0.5rem; overflow: auto; margin: 1rem 0; border: 1px solid rgba(255,255,255,0.1);"><code style="color: #dbeafe; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.04); color: #06b6d4; padding: 0.15rem 0.35rem; border-radius: 0.25rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;">$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color: #fff; font-weight: 600;">$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #06b6d4; text-decoration: none; border-bottom: 1px dotted #06b6d4;">$1</a>')
    .replace(/^[\-\*] (.*)$/gm, '<li style="margin: 0.25rem 0; color: #e6eef8;">$1</li>')
    .replace(/\n\n/g, '</p><p style="margin: 1rem 0; color: #e6eef8; line-height: 1.6;">')
    .replace(/\n/g, '<br>');

  html = '<p style="margin: 1rem 0; color: #e6eef8; line-height: 1.6;">' + html + '</p>';
  html = html.replace(/(<li[^>]*>.*?<\/li>(?:\s*<li[^>]*>.*?<\/li>)*)/gs, '<ul style="margin: 1rem 0; padding-left: 1.5rem; list-style-type: disc;">$1</ul>');
  return html;
};

const isValidGitHubUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  
  const trimmedUrl = url.trim();
  
  // Check if it contains github.com or is in owner/repo format
  const patterns = [
    /^(https?:\/\/)?(www\.)?github\.com\/[^\/\s]+\/[^\/\s]+/i,
    /^[^\/\s]+\/[^\/\s]+$/
  ];
  
  return patterns.some(pattern => pattern.test(trimmedUrl));
};

const sampleRepos = [
  { name: "microsoft/vscode", url: "https://github.com/microsoft/vscode" },
  { name: "facebook/react", url: "https://github.com/facebook/react" },
  { name: "vercel/next.js", url: "https://github.com/vercel/next.js" }
];

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [readme, setReadme] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [needsReset, setNeedsReset] = useState(false);
  const [displayedText, setDisplayedText] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [geminiStatus, setGeminiStatus] = useState(null);
  const [testingGemini, setTestingGemini] = useState(false);
  const [abortController, setAbortController] = useState(null);
  const [typingInterval, setTypingInterval] = useState(null);
  const [copied, setCopied] = useState(false);
  const [urlError, setUrlError] = useState("");
  const analysisRef = useRef(null);
  const previewRef = useRef(null);

  useEffect(() => {
    checkGeminiStatus();
  }, []);

  const checkGeminiStatus = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/test-gemini`);
      const data = await response.json();
      setGeminiStatus(data);
    } catch (err) {
      setGeminiStatus({ success: false, error: err.message });
    }
  };

  const testGeminiAPI = async () => {
    setTestingGemini(true);
    try {
      const response = await fetch(`${BACKEND_URL}/test-gemini`);
      const data = await response.json();
      setGeminiStatus(data);
      
      if (data.success) {
        setError("");
      } else {
        setError(`Gemini API Error: ${data.error}`);
      }
    } catch (err) {
      setError(`Failed to test Gemini API: ${err.message}`);
      setGeminiStatus({ success: false, error: err.message });
    } finally {
      setTestingGemini(false);
    }
  };

  const validateUrl = (url) => {
    if (!url.trim()) {
      setUrlError("Please enter a repository URL");
      return false;
    }
    
    if (!isValidGitHubUrl(url)) {
      setUrlError("Please enter a valid GitHub URL (e.g., https://github.com/owner/repository)");
      return false;
    }
    
    setUrlError("");
    return true;
  };

  const handleUrlChange = (url) => {
    setRepoUrl(url);
    if (urlError) {
      // Clear error if URL becomes valid
      if (url.trim() && isValidGitHubUrl(url)) {
        setUrlError("");
      }
    }
  };

  const stopGeneration = () => {
    if (abortController) {
      abortController.abort();
    }
    if (typingInterval) {
      clearInterval(typingInterval);
      setTypingInterval(null);
    }
    setLoading(false);
    setProgress("");
    setAbortController(null);
    setError("Generation stopped by user");
  };

  const generateReadme = async () => {
    if (needsReset) {
      resetAll();
      return;
    }

    if (!validateUrl(repoUrl)) {
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);

    setLoading(true);
    setDisplayedText("");
    setAnalysis(null);
    setError("");
    setUrlError("");
    setProgress("Analyzing repository...");

    try {
      const response = await fetch(`${BACKEND_URL}/generate-readme`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      
      setProgress("AI is writing your README...");
      setReadme(data.readme);
      setAnalysis(data.analysis);
      
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (analysisRef.current) {
            analysisRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          setTimeout(() => {
            if (previewRef.current) {
              previewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }, 800);
        }, 300);
      });

      let i = 0;
      const interval = setInterval(() => {
        if (controller.signal.aborted) {
          clearInterval(interval);
          return;
        }
        
        setDisplayedText((prev) => prev + data.readme[i]);
        i++;
        
        if (i > 200) {
          requestAnimationFrame(() => {
            const previewContainer = document.querySelector('[data-preview-content]');
            if (previewContainer) {
              previewContainer.scrollTop = previewContainer.scrollHeight;
            }
          });
        }
        
        if (i >= data.readme.length) {
          clearInterval(interval);
          setTypingInterval(null);
          setProgress("");
          setAbortController(null);
          
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (previewRef.current) {
                previewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }, 500);
          });
        }
      }, 1);

      setTypingInterval(interval);
      setNeedsReset(true);
      
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Request was cancelled');
        setProgress("");
        setError("Generation cancelled by user");
      } else {
        console.error("Error generating README:", err);
        setError(err.message || "Failed to generate README. Please try again.");
      }
      setProgress("");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setAbortController(null);
      }
    }
  };

  const downloadReadme = () => {
    if (!readme) return;
    const blob = new Blob([readme], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "README.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async () => {
    if (!readme) return;
    await navigator.clipboard.writeText(readme);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetAll = () => {
    if (abortController) {
      abortController.abort();
    }
    if (typingInterval) {
      clearInterval(typingInterval);
      setTypingInterval(null);
    }
    
    setReadme("");
    setDisplayedText("");
    setAnalysis(null);
    setNeedsReset(false);
    setProgress("");
    setError("");
    setUrlError("");
    setRepoUrl("");
    setLoading(false);
    setAbortController(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const buttonStyle = (variant = 'secondary', disabled = false) => ({
    padding: '12px 20px',
    borderRadius: '10px',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
    opacity: disabled ? 0.6 : 1,
    ...(variant === 'primary' ? {
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: '#fff',
      boxShadow: '0 4px 15px rgba(102, 126, 234, 0.3)',
    } : variant === 'danger' ? {
      background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
      color: '#fff',
      boxShadow: '0 4px 15px rgba(239, 68, 68, 0.3)',
    } : {
      background: 'rgba(255,255,255,0.06)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.1)',
    })
  });

  const inputStyle = {
    width: '96%',
    padding: '16px 20px',
    borderRadius: '12px',
    border: '2px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.03)',
    color: '#fff',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #000 0%, #1a1a2e 50%, #16213e 100%)', padding: '28px 20px' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .fade-in { animation: fadeIn 0.6s ease-out; }
        .slide-in { animation: slideIn 0.5s ease-out; }
        .pulse { animation: pulse 2s infinite; }
        .status-success { background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
        .status-error { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
        .status-loading { background: rgba(124, 58, 237, 0.1); color: #a855f7; border: 1px solid rgba(124, 58, 237, 0.3); }
        .card { background: rgba(255,255,255,0.02); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
        :root { --muted: #9ca3af; }
      `}</style>

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: '48px' }} className="fade-in">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ 
              width: '64px', height: '64px', 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
              borderRadius: '20px', 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 32px rgba(102, 126, 234, 0.4)'
            }}>
              <Zap size={32} color="white" />
            </div>
            <h1 style={{ 
              fontSize: 'clamp(2.5rem, 5vw, 4rem)', 
              fontWeight: '800', 
              background: 'linear-gradient(135deg, #667eea 0%, #06b6d4 50%, #764ba2 100%)', 
              backgroundClip: 'text', 
              WebkitBackgroundClip: 'text', 
              WebkitTextFillColor: 'transparent',
              margin: 0
            }}>
              AI README Generator
            </h1>
          </div>
          <p style={{ fontSize: '18px', color: 'var(--muted)', maxWidth: '600px', margin: '0 auto', lineHeight: '1.6' }}>
            Transform your GitHub repositories into professional documentation with Google Gemini AI
          </p>
        </header>

        {/* API Status */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '16px', marginBottom: '32px' }} className="fade-in">
          <div className={`${geminiStatus?.success ? 'status-success' : 'status-error'}`} style={{ 
            padding: '8px 16px', 
            borderRadius: '20px', 
            fontSize: '14px', 
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {geminiStatus === null ? (
              <><Loader size={16} className="pulse" /> Checking API...</>
            ) : geminiStatus.success ? (
              <><CheckCircle size={16} /> Gemini AI Ready</>
            ) : (
              <><XCircle size={16} /> API Connection Failed</>
            )}
          </div>
          <button 
            onClick={testGeminiAPI} 
            disabled={testingGemini}
            style={buttonStyle('secondary', testingGemini)}
          >
            {testingGemini ? <Loader size={16} className="pulse" /> : <Code size={16} />}
            {testingGemini ? "Testing..." : "Test Connection"}
          </button>
        </div>

        {geminiStatus?.error && (
          <div className="card" style={{ 
            maxWidth: '600px', 
            margin: '0 auto 32px', 
            padding: '16px 20px', 
            borderRadius: '12px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)'
          }}>
            <p style={{ color: '#f87171', fontSize: '14px', margin: 0 }}>{geminiStatus.error}</p>
          </div>
        )}

        {/* Sample Repositories */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }} className="fade-in">
          <p style={{ color: 'var(--muted)', marginBottom: '16px', fontSize: '14px' }}>Try with popular repositories:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px' }}>
            {sampleRepos.map((repo, i) => (
              <button 
                key={i}
                onClick={() => handleUrlChange(repo.url)} 
                style={{
                  ...buttonStyle('secondary'),
                  padding: '8px 16px',
                  fontSize: '12px'
                }}
              >
                <Github size={14} />
                {repo.name}
              </button>
            ))}
          </div>
        </div>

        {/* Main Input Section */}
        <div className="card" style={{ borderRadius: '24px', padding: '32px', marginBottom: '32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                value={repoUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && generateReadme()}
                placeholder="https://github.com/owner/repository"
                disabled={loading}
                style={{
                  ...inputStyle,
                  borderColor: urlError ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255,255,255,0.1)'
                }}
                onFocus={(e) => e.target.style.borderColor = '#667eea'}
                onBlur={(e) => e.target.style.borderColor = urlError ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255,255,255,0.1)'}
              />
              
              {urlError && (
                <div style={{ 
                  padding: '12px 16px', 
                  background: 'rgba(239, 68, 68, 0.1)', 
                  border: '1px solid rgba(239, 68, 68, 0.3)', 
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <XCircle size={16} color="#f87171" />
                  <span style={{ color: '#f87171', fontSize: '14px', fontWeight: '500' }}>{urlError}</span>
                </div>
              )}
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                <button 
                  onClick={generateReadme} 
                  disabled={loading || !geminiStatus?.success || urlError} 
                  style={{ ...buttonStyle('primary', loading || !geminiStatus?.success || urlError), minWidth: '160px', justifyContent: 'center' }}
                >
                  {loading ? (
                    <><Loader size={18} className="pulse" /> Generating</>
                  ) : needsReset ? (
                    <><RotateCcw size={18} /> New Generation</>
                  ) : (
                    <><Play size={18} /> Generate</>
                  )}
                </button>
                
                {loading && (
                  <button 
                    onClick={stopGeneration} 
                    style={buttonStyle('danger')}
                  >
                    <Square size={16} />
                    Stop
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div style={{ 
                padding: '16px 20px', 
                background: 'rgba(239, 68, 68, 0.1)', 
                border: '1px solid rgba(239, 68, 68, 0.3)', 
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <XCircle size={20} color="#f87171" />
                <span style={{ color: '#f87171', fontWeight: '500' }}>{error}</span>
              </div>
            )}

            {progress && (
              <div style={{ 
                padding: '16px 20px', 
                background: 'rgba(124, 58, 237, 0.1)', 
                border: '1px solid rgba(124, 58, 237, 0.3)', 
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Loader size={18} className="pulse" color="#a855f7" />
                  <span style={{ color: '#a855f7', fontWeight: '500' }}>{progress}</span>
                </div>
                {loading && (
                  <button 
                    onClick={stopGeneration} 
                    style={{
                      background: 'rgba(239, 68, 68, 0.8)',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      color: '#fff',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    <Square size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Repository Analysis */}
        {analysis && (
          <div ref={analysisRef} className="card slide-in" style={{ borderRadius: '20px', padding: '32px', marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <Code size={24} color="#06b6d4" />
              <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#fff', margin: 0 }}>Repository Analysis</h2>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '24px' }}>
              <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px' }}>
                <div style={{ color: '#10b981', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>Language</div>
                <div style={{ color: '#fff', fontSize: '18px', fontWeight: '700' }}>{analysis.language || 'Mixed'}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(124, 58, 237, 0.1)', border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: '12px' }}>
                <div style={{ color: '#a855f7', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>Project Type</div>
                <div style={{ color: '#fff', fontSize: '18px', fontWeight: '700' }}>{analysis.type || 'Application'}</div>
              </div>
              <div style={{ padding: '16px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '12px' }}>
                <div style={{ color: '#f59e0b', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>Files Analyzed</div>
                <div style={{ color: '#fff', fontSize: '18px', fontWeight: '700' }}>{analysis.fileCount || 'Multiple'}</div>
              </div>
            </div>

            {analysis.features && analysis.features.length > 0 && (
              <div>
                <h3 style={{ color: '#06b6d4', fontSize: '18px', fontWeight: '600', marginBottom: '12px' }}>Key Features Detected</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {analysis.features.map((feature, i) => (
                    <span key={i} style={{
                      padding: '6px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '16px',
                      fontSize: '12px',
                      color: '#e6eef8'
                    }}>
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* README Preview */}
        {readme && (
          <div ref={previewRef} className="slide-in">
            <div className="card" style={{ borderRadius: '20px', padding: '32px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <FileText size={24} color="#06b6d4" />
                  <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#fff', margin: 0 }}>Generated README</h2>
                </div>
                
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <button onClick={copyToClipboard} style={buttonStyle('secondary')}>
                    {copied ? <CheckCircle size={16} color="#10b981" /> : <Copy size={16} />}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button onClick={downloadReadme} style={buttonStyle('secondary')}>
                    <Download size={16} />
                    Download
                  </button>
                  <button onClick={resetAll} style={buttonStyle('secondary')}>
                    <RotateCcw size={16} />
                    New README
                  </button>
                </div>
              </div>

              <div 
                data-preview-content
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  padding: '24px',
                  maxHeight: '600px',
                  overflow: 'auto',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                  fontSize: '14px',
                  lineHeight: '1.6'
                }}
              >
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(displayedText) }} />
                {loading && displayedText.length < readme.length && (
                  <div style={{ 
                    display: 'inline-block', 
                    width: '2px', 
                    height: '20px', 
                    background: '#06b6d4',
                    animation: 'pulse 1s infinite',
                    marginLeft: '2px'
                  }} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}