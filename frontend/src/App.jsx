
import React, { useState, useRef, useEffect } from "react";

import {

  Github,

  Download,

  Copy,

  RotateCcw,

  Play,

  Square,

  CheckCircle,

  XCircle,

  Loader,

  Code,

  FileText,

  Zap,

  Clock,

  Activity,

  User,

  LogOut,

  Shield,

  Lock,

  Globe,

  AlertTriangle,

} from "lucide-react";



// Backend URL with localhost preference

// FIXED: Proper backend URL detection
const BACKEND_URL = process.env.NODE_ENV === "development"
  ? "http://localhost:5000"
  : process.env.REACT_APP_BACKEND_URL || "https://readme-not.vercel.app/";



const renderMarkdown = (text) => {

  if (!text) return "";



  let html = text

    .replace(/^### (.*$)/gm, '<h3 class="markdown-h3">$1</h3>')

    .replace(/^## (.*$)/gm, '<h2 class="markdown-h2">$1</h2>')

    .replace(/^# (.*$)/gm, '<h1 class="markdown-h1">$1</h1>')

    .replace(

      /``````/g,

      '<pre class="markdown-pre"><code>$2</code></pre>'

    )

    .replace(

      /`([^`]+)`/g,

      '<code class="inline-code">$1</code>'

    )

    .replace(/\*\*(.*?)\*\*/g, '<strong class="markdown-strong">$1</strong>')

    .replace(

      /\[([^\]]+)\]\(([^)]+)\)/g,

      '<a href="$2" target="_blank" rel="noopener noreferrer" class="markdown-link">$1</a>'

    )

    .replace(/^[\-\*] (.*)$/gm, '<li class="markdown-li">$1</li>')

    .replace(/\n\n/g, '</p><p class="markdown-p">')

    .replace(/\n/g, "<br>");



  html =

    '<p class="markdown-p">' +

    html +

    "</p>";

  html = html.replace(

    /(<li[^>]*>.*?<\/li>(?:\s*<li[^>]*>.*?<\/li>)*)/gs,

    '<ul class="markdown-ul">$1</ul>'

  );

  return html;

};



const sampleRepos = [

  { name: "microsoft/vscode", url: "https://github.com/microsoft/vscode" },

  { name: "facebook/react", url: "https://github.com/facebook/react" },

  { name: "vercel/next.js", url: "https://github.com/vercel/next.js" },

];



export default function App() {

  const [repoUrl, setRepoUrl] = useState("");

  const [readme, setReadme] = useState("");

  const [loading, setLoading] = useState(false);

  const [analysis, setAnalysis] = useState(null);

  const [needsReset, setNeedsReset] = useState(false);

  const [displayedText, setDisplayedText] = useState("");

  const [progress, setProgress] = useState({

    step: "",

    progress: 0,

    message: "",

    estimatedTime: 0,

  });

  const [error, setError] = useState("");

  const [geminiStatus, setGeminiStatus] = useState(null);

  const [testingGemini, setTestingGemini] = useState(false);

  const [abortController, setAbortController] = useState(null);

  const [typingInterval, setTypingInterval] = useState(null);

  const [copied, setCopied] = useState(false);

  const [sessionId, setSessionId] = useState(null);

  const [eventSource, setEventSource] = useState(null);

  const [user, setUser] = useState(null);

  const [checkingAuth, setCheckingAuth] = useState(true);

  const [repoStatus, setRepoStatus] = useState(null);

  const [checkingRepo, setCheckingRepo] = useState(false);

  const [showAuthDialog, setShowAuthDialog] = useState(false);

  const analysisRef = useRef(null);

  const previewRef = useRef(null);



  // Initial checks on mount

// Replace the existing useEffect with OAuth handling
useEffect(() => {
  checkAuthStatus();
  checkGeminiStatus();

  // IMPROVED: Better OAuth callback handling
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("auth") === "success") {
    const username = urlParams.get("user");
    setError(""); // Clear any previous errors
    setTimeout(() => checkAuthStatus(), 500); // Small delay for session sync
    window.history.replaceState({}, document.title, window.location.pathname);
    if (username) {
      console.log(`Authentication successful for ${username}`);
    }
  }
  if (urlParams.get("error")) {
    const errorType = urlParams.get("error");
    const details = urlParams.get("details");
    
    // IMPROVED: More user-friendly error messages
    let errorMessage = "Authentication failed";
    if (errorType === "oauth_access_denied") {
      errorMessage = "GitHub access was denied. Please try again.";
    } else if (errorType === "state_expired") {
      errorMessage = "Login session expired. Please try again.";
    } else if (details) {
      errorMessage = `Authentication failed: ${decodeURIComponent(details)}`;
    }
    
    setError(errorMessage);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}, []);


  const checkAuthStatus = async () => {

    try {

      const response = await fetch(`${BACKEND_URL}/auth/user`, {

        credentials: "include",

      });

      const data = await response.json();

      setUser(data.authenticated ? data.user : null);

    } catch (err) {

      setUser(null);

    } finally {

      setCheckingAuth(false);

    }

  };



  const checkGeminiStatus = async () => {

    try {

      const response = await fetch(`${BACKEND_URL}/test-gemini`);

      const data = await response.json();

      setGeminiStatus(data);

    } catch (err) {

      setGeminiStatus({ success: false, error: err.message });

    }

  };



  const checkRepository = async (url) => {

    if (!url.trim()) {

      setRepoStatus(null);

      return;

    }

    setCheckingRepo(true);

    try {

      const response = await fetch(`${BACKEND_URL}/check-repo`, {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        credentials: "include",

        body: JSON.stringify({ repoUrl: url }),

      });

      const data = await response.json();

      setRepoStatus(data);



      if (!data.accessible && data.requiresAuth && !user) {

        setShowAuthDialog(true);

      }

    } catch (err) {

      setRepoStatus({ accessible: false, error: err.message });

    } finally {

      setCheckingRepo(false);

    }

  };



  const handleRepoUrlChange = (url) => {

    setRepoUrl(url);

    setError("");

    setRepoStatus(null);

    clearTimeout(window.repoCheckTimeout);

    window.repoCheckTimeout = setTimeout(() => {

      if (url.trim()) {

        checkRepository(url);

      }

    }, 500);

  };



  const handleGitHubLogin = () => {

    window.location.href = `${BACKEND_URL}/auth/github`;

  };



  const handleLogout = async () => {

    try {

      await fetch(`${BACKEND_URL}/auth/logout`, {

        method: "POST",

        credentials: "include",

      });

      setUser(null);

      setRepoStatus(null);

      if (repoUrl) {

        checkRepository(repoUrl);

      }

    } catch {

      setError("Failed to logout");

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



  const stopGeneration = () => {

    if (abortController) abortController.abort();

    if (typingInterval) {

      clearInterval(typingInterval);

      setTypingInterval(null);

    }

    if (eventSource) {

      eventSource.close();

      setEventSource(null);

    }

    setLoading(false);

    setProgress({ step: "", progress: 0, message: "", estimatedTime: 0 });

    setAbortController(null);

    setError("Generation stopped by user");

  };



  const generateSessionId = () =>

    Math.random().toString(36).substring(2, 15) +

    Math.random().toString(36).substring(2, 15);



  const connectToProgressStream = (sessionId) => {

    const es = new EventSource(`${BACKEND_URL}/progress/${sessionId}`);



    es.onmessage = (event) => {

      try {

        const data = JSON.parse(event.data);

        if (data.step === "error") {

          setError(data.message);

          setLoading(false);

          es.close();

        } else if (data.step === "complete") {

          setProgress(data);

          setTimeout(() => {

            setProgress({ step: "", progress: 0, message: "", estimatedTime: 0 });

          }, 2000);

        } else {

          setProgress(data);

        }

      } catch (err) {

        console.error("Error parsing progress data:", err);

      }

    };



    es.onerror = (error) => {

      console.error("EventSource failed:", error);

      es.close();

    };



    setEventSource(es);

    return es;

  };



  const generateReadme = async () => {

    if (needsReset) {

      resetAll();

      return;

    }

    if (!repoUrl.trim()) {

      setError("Please enter a repository URL");

      return;

    }

    if (repoStatus && !repoStatus.accessible && repoStatus.requiresAuth && !user) {

      setShowAuthDialog(true);

      return;

    }

    const newSessionId = generateSessionId();

    setSessionId(newSessionId);

    const controller = new AbortController();

    setAbortController(controller);

    setLoading(true);

    setDisplayedText("");

    setAnalysis(null);

    setError("");

    setProgress({

      step: "starting",

      progress: 0,

      message: "Initializing...",

      estimatedTime: 60,

    });

    const es = connectToProgressStream(newSessionId);



    try {

      const response = await fetch(`${BACKEND_URL}/generate-readme`, {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        credentials: "include",

        body: JSON.stringify({ repoUrl: repoUrl.trim(), sessionId: newSessionId }),

        signal: controller.signal,

      });



      if (!response.ok) {

        const errorData = await response.json();

        if (response.status === 401 && errorData.requiresAuth) {

          setShowAuthDialog(true);

          return;

        }

        throw new Error(errorData.error || `Server error: ${response.status}`);

      }



      const data = await response.json();



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

            const previewContainer = document.querySelector("[data-preview-content]");

            if (previewContainer) {

              previewContainer.scrollTop = previewContainer.scrollHeight;

            }

          });

        }

        if (i >= data.readme.length) {

          clearInterval(interval);

          setTypingInterval(null);

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

      if (err.name === "AbortError") {

        setProgress({ step: "", progress: 0, message: "", estimatedTime: 0 });

        setError("Generation cancelled by user");

      } else {

        setError(err.message || "Failed to generate README. Please try again.");

      }

      setProgress({ step: "", progress: 0, message: "", estimatedTime: 0 });

    } finally {

      if (!controller.signal.aborted) {

        setLoading(false);

        setAbortController(null);

      }

      if (es) es.close();

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

    if (abortController) abortController.abort();

    if (typingInterval) {

      clearInterval(typingInterval);

      setTypingInterval(null);

    }

    if (eventSource) {

      eventSource.close();

      setEventSource(null);

    }

    setReadme("");

    setDisplayedText("");

    setAnalysis(null);

    setNeedsReset(false);

    setProgress({ step: "", progress: 0, message: "", estimatedTime: 0 });

    setError("");

    setRepoUrl("");

    setRepoStatus(null);

    setLoading(false);

    setAbortController(null);

    setSessionId(null);

    setShowAuthDialog(false);

    window.scrollTo({ top: 0, behavior: "smooth" });

  };



  const buttonStyle = (variant = "secondary", disabled = false) => ({

    padding: "12px 20px",

    borderRadius: "10px",

    border: "none",

    cursor: disabled ? "not-allowed" : "pointer",

    fontSize: "14px",

    fontWeight: "600",

    display: "flex",

    alignItems: "center",

    gap: "8px",

    transition: "all 0.2s ease",

    opacity: disabled ? 0.6 : 1,

    ...(variant === "primary"

      ? {

          background:

            "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",

          color: "#fff",

          boxShadow: "0 4px 15px rgba(102, 126, 234, 0.3)",

        }

      : variant === "danger"

      ? {

          background:

            "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",

          color: "#fff",

          boxShadow: "0 4px 15px rgba(239, 68, 68, 0.3)",

        }

      : variant === "github"

      ? {

          background:

            "linear-gradient(135deg, #24292e 0%, #1a1e22 100%)",

          color: "#fff",

          boxShadow: "0 4px 15px rgba(36, 41, 46, 0.3)",

        }

      : {

          background: "rgba(255,255,255,0.06)",

          color: "#fff",

          border: "1px solid rgba(255,255,255,0.1)",

        }),

  });



  const inputStyle = {

    width: "100%",

    padding: "16px 20px",

    borderRadius: "12px",

    border: "2px solid rgba(255,255,255,0.1)",

    background: "rgba(255,255,255,0.03)",

    color: "#fff",

    fontSize: "15px",

    outline: "none",

    transition: "border-color 0.2s ease",

  };



  const formatTime = (seconds) => {

    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);

    const remainingSeconds = seconds % 60;

    return `${minutes}m ${remainingSeconds}s`;

  };



  const getRepoStatusIcon = () => {

    if (checkingRepo) return <Loader size={16} className="pulse" />;

    if (!repoStatus) return null;

    if (repoStatus.accessible) {

      return repoStatus.repoData?.private ? (

        <Lock size={16} color="#f59e0b" />

      ) : (

        <Globe size={16} color="#10b981" />

      );

    } else {

      return <XCircle size={16} color="#ef4444" />;

    }

  };



  const getRepoStatusText = () => {

    if (checkingRepo) return "Checking repository...";

    if (!repoStatus) return "";

    if (repoStatus.accessible) {

      return repoStatus.repoData?.private ? "Private repository" : "Public repository";

    } else if (repoStatus.requiresAuth) {

      return "Private repository - Authentication required";

    } else if (repoStatus.error === "REPO_NOT_FOUND") {

      return "Repository not found";

    } else {

      return "Repository not accessible";

    }

  };



  if (checkingAuth) {

    return (

      <main className="loading-screen" aria-busy="true" aria-live="polite">

        <Loader size={48} className="pulse" color="#667eea" />

        <p>Loading...</p>

      </main>

    );

  }



  return (

    <main className="app-container" role="main">

      {/* Header */}

      <header className="app-header" role="banner">

        <div className="header-top">

          <div className="header-left" aria-hidden="true"></div>



          <div className="header-center">

            <div className="logo">

              <Zap size={32} color="white" aria-hidden="true" />

            </div>

            <h1 className="heading-main">AI README Generator</h1>

          </div>



          <div className="header-right">

            {user ? (

              <section

                className="user-profile"

                aria-label="User Profile Information"

                tabIndex={0}

              >

                <img

                  src={user.avatar_url}

                  alt={`${user.login} avatar`}

                  className="user-avatar"

                />

                <span className="user-name">{user.name || user.login}</span>

                <button onClick={handleLogout} aria-label="Logout" className="btn-logout">

                  <LogOut size={16} />

                </button>

              </section>

            ) : (

              <div className="guest-indicator" aria-label="Guest User Indicator" tabIndex={0}>

                <User size={16} />

                <span>Guest</span>

              </div>

            )}

          </div>

        </div>



        <p className="subtitle">

          Transform your GitHub repositories into professional documentation with Google Gemini AI

        </p>

      </header>



      {/* API Status */}

      <section className="api-status" aria-live="polite" aria-atomic="true">

        <div

          className={`status-badge ${

            geminiStatus?.success ? "status-success" : "status-error"

          }`}

          role="status"

        >

          {geminiStatus === null ? (

            <>

              <Loader size={16} className="pulse" /> Checking API...

            </>

          ) : geminiStatus.success ? (

            <>

              <CheckCircle size={16} /> Gemini AI Ready

            </>

          ) : (

            <>

              <XCircle size={16} /> API Connection Failed

            </>

          )}

        </div>

        <button

          onClick={testGeminiAPI}

          disabled={testingGemini}

          className="btn-secondary"

        >

          {testingGemini ? (

            <>

              <Loader size={16} className="pulse" /> Testing...

            </>

          ) : (

            <>

              <Code size={16} /> Test Connection

            </>

          )}

        </button>

      </section>



      {geminiStatus?.error && (

        <section className="error-card" role="alert">

          <p>{geminiStatus.error}</p>

        </section>

      )}



      {/* Sample Repositories Buttons */}

      <section className="sample-repos" aria-label="Sample Repositories">

        <p className="sample-text">Try with popular repositories:</p>

        <div className="repo-buttons">

          {sampleRepos.map((repo, i) => (

            <button

              key={i}

              onClick={() => handleRepoUrlChange(repo.url)}

              className="btn-secondary small"

            >

              <Github size={14} /> {repo.name}

            </button>

          ))}

        </div>

      </section>



      {/* Input & Controls Section */}

      <section className="main-input card" aria-label="Repository input and controls">

        <div className="input-group">

          <div className="input-wrapper">

            <input

              type="url"

              value={repoUrl}

              onChange={(e) => handleRepoUrlChange(e.target.value)}

              onKeyDown={(e) => e.key === "Enter" && !loading && generateReadme()}

              placeholder="https://github.com/owner/repository"

              disabled={loading}

              aria-invalid={error && !repoUrl.trim()}

              aria-describedby="repo-status-text"

              className={`input-field ${

                error && !repoUrl.trim() ? "input-error" : repoStatus?.accessible ? "input-valid" : ""

              }`}

            />

            {(repoStatus || checkingRepo) && (

              <div className="repo-status-icon" aria-hidden="true">

                {getRepoStatusIcon()}

              </div>

            )}

          </div>



          {(repoStatus || checkingRepo) && (

            <div

              id="repo-status-text"

              className={`repo-status-text ${

                checkingRepo

                  ? "status-loading"

                  : repoStatus.accessible

                  ? repoStatus.repoData?.private

                    ? "status-warning"

                    : "status-success"

                  : "status-error"

              }`}

              role="status"

              aria-live="polite"

              tabIndex={-1}

            >

              {getRepoStatusIcon()}

              <span>{getRepoStatusText()}</span>

              {repoStatus &&

                !repoStatus.accessible &&

                repoStatus.requiresAuth &&

                !user && (

                  <button onClick={() => setShowAuthDialog(true)} className="btn-github small">

                    <Github size={14} /> Login

                  </button>

                )}

            </div>

          )}

        </div>



        <div className="button-group">

          <button

            onClick={generateReadme}

            disabled={

              loading || !geminiStatus?.success || (repoStatus && !repoStatus.accessible && !user)

            }

            className="btn-primary"

          >

            {loading ? (

              <>

                <Loader size={18} className="pulse" /> Generating

              </>

            ) : needsReset ? (

              <>

                <RotateCcw size={18} /> New Generation

              </>

            ) : (

              <>

                <Play size={18} /> Generate

              </>

            )}

          </button>



          {loading && (

            <button onClick={stopGeneration} className="btn-danger">

              <Square size={16} /> Stop

            </button>

          )}



          {!user && (

            <button onClick={handleGitHubLogin} className="btn-github">

              <Github size={16} /> Login with GitHub

            </button>

          )}

        </div>



        {error && (

          <div className="error-msg" role="alert">

            <XCircle size={20} /> <span>{error}</span>

          </div>

        )}



        {progress.message && (

          <div className="progress-container" aria-live="polite" aria-atomic="true">

            <div className="progress-header">

              <div className="progress-info">

                {progress.step === "fetching" && <Activity size={18} className="pulse" />}

                {progress.step === "analyzing" && <Code size={18} className="pulse" />}

                {progress.step === "generating" && <Loader size={18} className="pulse" />}

                {progress.step === "complete" && <CheckCircle size={18} />}

                <span>{progress.message}</span>

              </div>

              <div className="time-progress">

                {progress.estimatedTime > 0 && (

                  <div className="estimated-time">

                    <Clock size={14} /> ~{formatTime(progress.estimatedTime)}

                  </div>

                )}

                <span className="progress-percent">{progress.progress}%</span>

              </div>

            </div>

            <div className="progress-bar-bg" aria-hidden="true">

              <div

                className={`progress-bar-fill ${

                  progress.step === "complete" ? "progress-success" : "progress-active"

                }`}

                style={{ width: `${progress.progress}%` }}

              />

            </div>

          </div>

        )}



        <div className="output-controls">

          <div className="output-buttons">

            <button onClick={downloadReadme} disabled={!readme} className="btn-secondary">

              <Download size={16} /> Download

            </button>

            <button onClick={copyToClipboard} disabled={!readme} className="btn-secondary">

              {copied ? (

                <>

                  <CheckCircle size={16} color="#10b981" /> Copied!

                </>

              ) : (

                <>

                  <Copy size={16} /> Copy Markdown

                </>

              )}

            </button>

            <button onClick={resetAll} className="btn-secondary">

              <RotateCcw size={16} /> Reset

            </button>

          </div>

          {analysis && (

            <div className="analysis-summary" aria-live="polite" tabIndex={-1}>

              Processed {analysis.totalFiles} files •{" "}

              {analysis.repositoryStats?.private ? "Private" : "Public"} repo

            </div>

          )}

        </div>

      </section>



      {/* Analysis Section */}

      {analysis && (

        <section

          ref={analysisRef}

          className="analysis-section card"

          aria-label="Repository analysis summary"

        >

          <header className="analysis-header">

            <div className="analysis-icon">

              <FileText size={24} color="white" />

            </div>

            <h2>Repository Analysis Complete</h2>

            {analysis.repositoryStats?.private && (

              <div className="private-badge" aria-label="Private Repository">

                <Shield size={12} /> Private

              </div>

            )}

          </header>



          <div className="analysis-grid">

            <article className="analysis-card" tabIndex={0}>

              <div className="card-icon file-icon">

                <FileText size={20} color="white" />

              </div>

              <h3>Files Processed</h3>

              <p>{analysis.totalFiles}</p>

            </article>



            <article className="analysis-card" tabIndex={0}>

              <div className="card-icon code-icon">

                <Code size={20} color="white" />

              </div>

              <h3>Primary Language</h3>

              <p>{analysis.primaryLanguage}</p>

            </article>



            <article className="analysis-card" tabIndex={0}>

              <div className="card-icon activity-icon">

                <Activity size={20} color="white" />

              </div>

              <h3>Complexity</h3>

              <p>{analysis.summary?.projectComplexity || "Simple"}</p>

            </article>



            <article className="analysis-card" tabIndex={0}>

              <div className="card-icon stars-icon">

                <Github size={20} color="white" />

              </div>

              <h3>Stars</h3>

              <p>{analysis.repositoryStats?.stars?.toLocaleString() || 0}</p>

            </article>

          </div>

        </section>

      )}



      {/* Preview Section */}

      {displayedText && (

        <section

          ref={previewRef}

          className="preview-section card"

          aria-label="Generated README preview"

        >

          <header className="preview-header">

            <div className="preview-icon">

              <FileText size={24} color="white" />

            </div>

            <h2>Generated README</h2>

            <div className="preview-controls">

              <button onClick={copyToClipboard} className="btn-secondary">

                {copied ? (

                  <>

                    <CheckCircle size={16} color="#10b981" /> Copied!

                  </>

                ) : (

                  <>

                    <Copy size={16} /> Copy Markdown

                  </>

                )}

              </button>

              <button onClick={downloadReadme} className="btn-primary">

                <Download size={16} /> Download

              </button>

            </div>

          </header>



          <article

            data-preview-content

            className="markdown preview-content"

            tabIndex={0}

            dangerouslySetInnerHTML={{ __html: renderMarkdown(displayedText) }}

          />



          {displayedText.length < readme.length && (

            <div className="loading-indicator" aria-live="polite">

              <Loader size={20} className="pulse" color="#06b6d4" />

              <span>AI is writing your documentation...</span>

            </div>

          )}

        </section>

      )}



      {/* Auth Dialog Modal */}

      {showAuthDialog && (

        <div

          className="modal-overlay"

          role="dialog"

          aria-modal="true"

          aria-labelledby="auth-dialog-title"

          onClick={() => setShowAuthDialog(false)}

          tabIndex={-1}

        >

          <div

            className="modal-card"

            onClick={(e) => e.stopPropagation()}

            tabIndex={0}

          >

            <div className="modal-icon" aria-hidden="true">

              <Github size={32} color="white" />

            </div>



            <h3 id="auth-dialog-title">GitHub Authentication Required</h3>



            <p>

              This repository is private and requires GitHub authentication to

              access. Sign in with your GitHub account to generate a README for

              private repositories.

            </p>



            <div className="modal-buttons">

              <button

                onClick={() => setShowAuthDialog(false)}

                className="btn-secondary"

              >

                Cancel

              </button>

              <button onClick={handleGitHubLogin} className="btn-github">

                <Github size={16} /> Sign in with GitHub

              </button>

            </div>

          </div>

        </div>

      )}

    </main>

  );

}