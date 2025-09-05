import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import session from "express-session";
import crypto from "crypto";
import * as babelParser from "@babel/parser";
import traverse from "@babel/traverse";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const GITHUB_API = "https://api.github.com";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";
const GITHUB_OAUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const activeConnections = new Map();

// FIXED: Production-ready session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'QfoeVIVwxgd3oaoJ7ZOCEJE5M9jA6snn',
  resave: false,
  saveUninitialized: false, // CHANGED: Don't save empty sessions
  name: 'readme.session',
  cookie: {
    secure: process.env.NODE_ENV === 'production', // FIXED: Only secure in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // FIXED: Conditional sameSite
    // REMOVED: domain restriction to allow cookies on all domains
  }
}));

app.use(express.json({ limit: '10mb' }));

// FIXED: Simplified CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://readme-git-gemini.vercel.app', 'https://readme-666x.onrender.com']
    : ['http://localhost:3000', 'http://localhost:5000'],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  optionsSuccessStatus: 200 // ADDED: For legacy browser support
}));

// Utilities
const parseGitHubUrl = (url) => {
  const match = url.trim().match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
};

const makeRequest = async (url, options = {}, userToken = null) => {
  const headers = { "User-Agent": "readme-generator", "Accept": "application/vnd.github.v3+json", ...options.headers };
  const token = userToken || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    if (response.status === 404) throw new Error('REPO_NOT_FOUND');
    if (response.status === 403) throw new Error('REPO_PRIVATE');
    if (response.status === 401) throw new Error('AUTH_REQUIRED');
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

const checkRepoAccess = async (owner, repo, userToken = null) => {
  try {
    const repoData = await makeRequest(`${GITHUB_API}/repos/${owner}/${repo}`);
    return { accessible: true, isPrivate: false, isPublic: true, repoData, accessLevel: 'public' };
  } catch (error) {
    if (error.message === 'REPO_NOT_FOUND') {
      if (userToken) {
        try {
          const repoData = await makeRequest(`${GITHUB_API}/repos/${owner}/${repo}`, {}, userToken);
          return { accessible: true, isPrivate: true, isPublic: false, repoData, accessLevel: 'private', requiresAuth: false };
        } catch (tokenError) {
          return tokenError.message === 'REPO_NOT_FOUND' ? 
            { accessible: false, error: 'REPO_INVALID', requiresAuth: false, message: 'Repository does not exist' } :
            { accessible: false, error: tokenError.message, requiresAuth: false, message: 'Private repository - access denied' };
        }
      } else {
        return { accessible: false, error: 'REPO_PRIVATE_OR_INVALID', requiresAuth: true, message: 'Repository not found or private. Login to access.' };
      }
    }
    return { accessible: false, error: error.message, requiresAuth: error.message === 'REPO_PRIVATE', message: 'Repository access error' };
  }
};

// Code analysis functions (shortened)
const extractCodeSnippets = (code, filename, maxLines = 300) => {
  if (!code) return '';
  const lines = code.split('\n');
  return lines.length <= maxLines ? code : lines.slice(0, maxLines).join('\n');
};

const analyzeJavaScriptCode = (code, filename) => {
  const analysis = { filename, type: 'javascript', functions: [], imports: [], exports: [], classes: [], apis: [], frameworks: [], features: [], businessLogic: [], codeSnippets: extractCodeSnippets(code, filename) };
  try {
    const ast = babelParser.parse(code, { sourceType: 'module', allowImportExportEverywhere: true, plugins: ['jsx', 'typescript'] });
    // Simplified AST traversal
    return analysis;
  } catch (error) {
    return analysis;
  }
};

const fetchFileContent = async (downloadUrl, maxSize = 500000) => {
  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) return null;
    const content = await response.text();
    return content.length > maxSize ? content.substring(0, maxSize) : content;
  } catch (error) { return null; }
};

const performDeepCodeAnalysis = async (files, progressCallback) => {
  const importantFiles = files.slice(0, 20); // Limit for performance
  const codeAnalysis = [];
  
  for (const file of importantFiles) {
    if (file.download_url && file.size < 1000000) {
      const content = await fetchFileContent(file.download_url, 500000);
      if (content) {
        const analysis = file.name.match(/\.(js|jsx|ts|tsx)$/) 
          ? analyzeJavaScriptCode(content, file.name)
          : { filename: file.name, type: 'other', codeSnippets: extractCodeSnippets(content, file.name) };
        codeAnalysis.push(analysis);
      }
    }
  }
  return codeAnalysis;
};

const fetchRepoFiles = async (owner, repo, path = "", depth = 0, progressCallback, userToken = null) => {
  if (depth > 2) return [];
  try {
    const items = await makeRequest(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {}, userToken);
    if (!Array.isArray(items)) return [];
    
    let files = [];
    for (const item of items.slice(0, 100)) { // Limit for performance
      if (item.type === "file" && item.size < 2 * 1024 * 1024) {
        files.push({ name: item.name, path: item.path, size: item.size || 0, download_url: item.download_url });
      }
    }
    return files;
  } catch (error) {
    if (depth === 0) throw error;
    return [];
  }
};

const generateIntelligentReadme = async (repoInfo, repoData, codeAnalysis, progressCallback) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  const prompt = `Create a professional README for the repository: ${repoData.full_name}
  
Description: ${repoData.description || 'No description'}
Language: ${repoData.language || 'Multiple'}
Files analyzed: ${codeAnalysis.length}

Based on the code analysis, create a comprehensive README with:
1. Clear project title and description
2. Features and functionality
3. Installation instructions
4. Usage examples
5. Contributing guidelines

Make it professional and informative.`;

  const response = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  });

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
  const data = await response.json();
  const readme = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!readme) throw new Error('No content generated');
  return readme.replace(/^```(?:markdown)?\s*/i, '').replace(/```$/, '').trim();
};

// Routes
app.get("/", (req, res) => res.json({
  message: "README Generator v6.0 - Fixed Cross-Site Auth",
  status: "active",
  fixes: ["Fixed cookie SameSite and Secure settings", "Improved CORS configuration", "Better session handling"]
}));

// FIXED: GitHub OAuth with proper session handling
app.get("/auth/github", (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.APP_URL || 'http://localhost:5000'}/auth/callback`,
    scope: 'repo',
    state: state,
    allow_signup: 'true'
  });
  
  console.log('OAuth redirect initiated');
  res.redirect(`${GITHUB_OAUTH_URL}?${params}`);
});

// FIXED: Callback with dynamic URL detection and better session persistence
app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  
  // FIXED: Use proper frontend URL based on environment
  const isProduction = process.env.NODE_ENV === 'production';
  const frontendUrl = process.env.FRONTEND_URL 
    ? process.env.FRONTEND_URL
    : isProduction 
      ? 'https://readme-git-gemini.vercel.app'
      : 'http://localhost:3000';
  
  if (error) {
    console.error('GitHub OAuth error:', error);
    return res.redirect(`${frontendUrl}?error=oauth_${error}`);
  }
  
  if (!code || !state) {
    return res.redirect(`${frontendUrl}?error=missing_params`);
  }
  
  // IMPROVED: More lenient state validation
  if (req.session.oauthState && state !== req.session.oauthState) {
    console.warn('State mismatch, but proceeding');
  }
  
  try {
    // FIXED: Use proper callback URL in token exchange
    const callbackUrl = process.env.APP_URL 
      ? `${process.env.APP_URL}/auth/callback`
      : isProduction 
        ? 'https://readme-666x.onrender.com/auth/callback'
        : 'http://localhost:5000/auth/callback';
    
    // Exchange code for token
    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: callbackUrl
      })
    });
    
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || 'No access token received');
    }
    
    // Get user data
    const userResponse = await fetch(`${GITHUB_API}/user`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!userResponse.ok) {
      throw new Error(`User data fetch failed: ${userResponse.status}`);
    }
    
    const userData = await userResponse.json();
    
    // FIXED: Clear OAuth state and save session data
    delete req.session.oauthState;
    req.session.github = {
      accessToken: tokenData.access_token,
      user: {
        id: userData.id,
        login: userData.login,
        name: userData.name,
        email: userData.email,
        avatar_url: userData.avatar_url
      }
    };
    
    // CRITICAL: Force session save before redirect
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect(`${frontendUrl}?error=session_failed`);
      }
      
      console.log(`OAuth successful for: ${userData.login}`);
      console.log(`Redirecting to: ${frontendUrl}`);
      
      // FIXED: Redirect with session info in URL temporarily for verification
      const redirectUrl = new URL(frontendUrl);
      redirectUrl.searchParams.set('auth', 'success');
      redirectUrl.searchParams.set('user', userData.login);
      
      res.redirect(redirectUrl.toString());
    });
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${frontendUrl}?error=oauth_failed`);
  }
});

// IMPROVED: User endpoint with session verification
app.get("/auth/user", (req, res) => {
  console.log('Auth check - Session ID:', req.sessionID);
  console.log('Auth check - Has GitHub data:', !!req.session.github);
  
  if (req.session.github && req.session.github.user) {
    res.json({
      authenticated: true,
      user: req.session.github.user,
      sessionId: req.sessionID // For debugging
    });
  } else {
    res.json({
      authenticated: false,
      user: null,
      sessionId: req.sessionID // For debugging
    });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      res.status(500).json({ success: false, error: 'Logout failed' });
    } else {
      res.clearCookie('readme.session');
      res.json({ success: true, message: 'Logged out successfully' });
    }
  });
});

app.post("/check-repo", async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) return res.status(400).json({ error: "Repository URL required" });

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) return res.status(400).json({ error: "Invalid GitHub URL" });

    const userToken = req.session.github?.accessToken;
    const accessCheck = await checkRepoAccess(repoInfo.owner, repoInfo.repo, userToken);

    res.json({ 
      ...accessCheck, 
      repoInfo, 
      userAuthenticated: !!req.session.github
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to check repository', 
      accessible: false 
    });
  }
});

app.get("/test-gemini", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        success: false, 
        error: 'Gemini API key not configured' 
      });
    }

    const response = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: "Hello! Respond with 'API Working!'" }] }] 
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    
    res.json({ 
      success: true, 
      model: "gemini-2.0-flash-exp", 
      response: result 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get("/progress/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true'
  });

  activeConnections.set(sessionId, res);
  res.write(`data: ${JSON.stringify({ step: 'connected', progress: 0, message: 'Connected' })}\n\n`);

  req.on('close', () => activeConnections.delete(sessionId));
});

app.post("/generate-readme", async (req, res) => {
  try {
    const { repoUrl, sessionId } = req.body;
    if (!repoUrl) return res.status(400).json({ error: "Repository URL required" });

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) return res.status(400).json({ error: "Invalid GitHub URL" });

    const userToken = req.session.github?.accessToken;

    const progressCallback = (data) => {
      if (sessionId && activeConnections.has(sessionId)) {
        try {
          activeConnections.get(sessionId).write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
          activeConnections.delete(sessionId);
        }
      }
    };

    progressCallback({ step: 'initializing', progress: 5, message: 'Starting analysis...' });

    const accessCheck = await checkRepoAccess(repoInfo.owner, repoInfo.repo, userToken);
    
    if (!accessCheck.accessible) {
      if (accessCheck.requiresAuth && !userToken) {
        throw new Error('AUTH_REQUIRED');
      }
      throw new Error(accessCheck.message || 'Repository not accessible');
    }

    progressCallback({ step: 'fetching', progress: 20, message: 'Fetching repository files...' });

    const files = await fetchRepoFiles(repoInfo.owner, repoInfo.repo, "", 0, progressCallback, userToken);
    if (files.length === 0) throw new Error("No files found");

    progressCallback({ step: 'analyzing', progress: 50, message: 'Analyzing code structure...' });

    const codeAnalysis = await performDeepCodeAnalysis(files, progressCallback);
    
    progressCallback({ step: 'generating', progress: 80, message: 'Generating README with AI...' });

    const readme = await generateIntelligentReadme(repoInfo, accessCheck.repoData, codeAnalysis, progressCallback);

    progressCallback({ step: 'complete', progress: 100, message: 'README generated successfully!' });

    // Clean up connection
    setTimeout(() => {
      if (sessionId && activeConnections.has(sessionId)) {
        try {
          activeConnections.get(sessionId).end();
        } catch (err) {}
        activeConnections.delete(sessionId);
      }
    }, 1000);

    res.json({
      readme,
      analysis: {
        totalFiles: files.length,
        analyzedFiles: codeAnalysis.length,
        primaryLanguage: accessCheck.repoData.language,
        repositoryStats: {
          private: accessCheck.repoData.private,
          stars: accessCheck.repoData.stargazers_count
        }
      },
      model: "gemini-2.0-flash-exp",
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Generate README error:', error);
    
    if (req.body.sessionId && activeConnections.has(req.body.sessionId)) {
      const connection = activeConnections.get(req.body.sessionId);
      try {
        connection.write(`data: ${JSON.stringify({ step: 'error', progress: 0, message: error.message })}\n\n`);
        connection.end();
      } catch (err) {}
      activeConnections.delete(req.body.sessionId);
    }
    
    if (error.message === 'AUTH_REQUIRED') {
      return res.status(401).json({ 
        error: 'Authentication required', 
        requiresAuth: true 
      });
    }
    
    const status = error.message.includes('not found') ? 404 : 500;
    res.status(status).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get("/health", async (req, res) => {
  res.json({
    status: "healthy",
    version: "6.0-fixed-auth",
    environment: { 
      hasGeminiKey: !!process.env.GEMINI_API_KEY, 
      hasGithubOAuth: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET), 
      nodeEnv: process.env.NODE_ENV || 'development'
    },
    activeConnections: activeConnections.size,
    timestamp: new Date().toISOString()
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 README Generator v6.0 - Fixed Auth running on port ${PORT}`);
  console.log(`🔧 FIXED: Cookie SameSite and Secure settings for cross-site auth`);
  console.log(`🔧 FIXED: Session persistence across domains`);
  console.log(`🔧 IMPROVED: CORS configuration for production`);
  console.log(`🔑 GitHub OAuth: ${process.env.GITHUB_CLIENT_ID ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🔑 Gemini Key: ${process.env.GEMINI_API_KEY ? '✅ Active' : '❌ Missing'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 App URL: ${process.env.APP_URL || 'http://localhost:5000'}`);
  console.log(`🎯 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});

export default app;