import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const GITHUB_API = "https://api.github.com";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

// Store active connections for progress updates
const activeConnections = new Map();

app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://localhost:5173',
    'https://readme-git-gemini.vercel.app/',
    /\.vercel\.app$/,
    /\.netlify\.app$/,
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

// Simplified repository analysis - only count files
async function analyzeRepository(files, repoData) {
  const analysis = {
    totalFiles: files.length,
    analyzedFiles: files.length,
    primaryLanguage: repoData.language || 'Unknown',
    repositoryStats: {
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      issues: repoData.open_issues_count || 0,
      size: repoData.size || 0
    }
  };

  return analysis;
}

// Utility functions
const parseGitHubUrl = (url) => {
  const patterns = [
    /github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/,
    /^([^\/\s]+)\/([^\/\s]+)$/
  ];
  
  for (const pattern of patterns) {
    const match = url.trim().match(pattern);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
};

const makeRequest = async (url, options = {}) => {
  const headers = { 
    "User-Agent": "readme-generator",
    "Accept": "application/vnd.github.v3+json",
    ...options.headers
  };
  
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
};

const fetchRepoFiles = async (owner, repo, path = "", depth = 0, progressCallback) => {
  if (depth > 3) return [];
  
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  
  try {
    const items = await makeRequest(url);
    if (!Array.isArray(items)) return [];
    
    let files = [];
    const totalItems = Math.min(items.length, 100);
    
    for (let i = 0; i < totalItems; i++) {
      const item = items[i];
      
      // Update progress
      if (progressCallback && depth === 0) {
        progressCallback({
          step: 'analyzing',
          progress: Math.round((i / totalItems) * 50), // 50% for file scanning
          message: `Scanning files... (${i + 1}/${totalItems})`
        });
      }
      
      if (item.type === "file" && item.size < 1024 * 1024) {
        files.push({
          name: item.name,
          path: item.path,
          size: item.size || 0,
          download_url: item.download_url
        });
      } else if (item.type === "dir" && depth < 2 && !item.name.startsWith('.') && 
                !['node_modules', 'vendor', 'dist', 'build', '__pycache__'].includes(item.name)) {
        const subFiles = await fetchRepoFiles(owner, repo, item.path, depth + 1, progressCallback);
        files = files.concat(subFiles);
      }
      
      // Small delay to prevent rate limiting
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    return files;
  } catch (error) {
    console.error(`Error fetching files from ${path}:`, error.message);
    if (depth === 0) throw error;
    return [];
  }
};

const generateReadme = async (repoInfo, files, repoData, progressCallback) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  // Update progress - starting analysis
  progressCallback({
    step: 'generating',
    progress: 60,
    message: 'Analyzing repository structure...',
    estimatedTime: 45
  });

  const analysis = await analyzeRepository(files, repoData);
  
  // Update progress - creating prompt
  progressCallback({
    step: 'generating',
    progress: 70,
    message: 'Creating AI prompt...',
    estimatedTime: 35
  });
  
  const prompt = `Generate a comprehensive README.md for this GitHub repository:

**Repository:** ${repoData.full_name}
**Description:** ${repoData.description || 'No description provided'}
**Primary Language:** ${analysis.primaryLanguage}
**Stars:** ${repoData.stargazers_count || 0}
**Total Files:** ${analysis.totalFiles}

Create a professional README with these sections in order:
1. **Title** (# format with repository name)
2. **Description** (comprehensive overview)
3. **Features** (key functionality and capabilities)
4. **Tech Stack** (technologies and frameworks used)
5. **Installation** (setup instructions)
6. **Usage** (how to use/run the project)
7. **API Documentation** (if applicable based on project type)
8. **Contributing** (contribution guidelines)
9. **License** (license information)

Make it engaging, professional, and include relevant badges. Use proper markdown formatting. Return ONLY markdown content without code blocks or delimiters.`;

  // Update progress - sending to AI
  progressCallback({
    step: 'generating',
    progress: 80,
    message: 'AI is generating your README...',
    estimatedTime: 25
  });

  const response = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  // Update progress - processing response
  progressCallback({
    step: 'generating',
    progress: 95,
    message: 'Finalizing README...',
    estimatedTime: 5
  });

  const data = await response.json();
  const readme = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!readme) {
    throw new Error('No content generated by Gemini API');
  }

  return readme.replace(/^```(?:markdown)?\s*/i, '').replace(/```$/, '').trim();
};

// API Endpoints
app.get("/", (req, res) => {
  res.json({
    message: "README Generator API v2.0",
    endpoints: ["/health", "/test-gemini", "/generate-readme"],
    model: "gemini-2.0-flash-exp"
  });
});

app.get("/test-gemini", async (req, res) => {
  try {
    const response = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hello! Respond with 'Gemini API working!'" }] }]
      })
    });

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    
    res.json({
      success: response.ok,
      model: "gemini-2.0-flash-exp",
      response: result,
      hasApiKey: !!process.env.GEMINI_API_KEY
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Server-Sent Events endpoint for progress updates
app.get("/progress/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Store this connection
  activeConnections.set(sessionId, res);

  // Send initial message
  res.write(`data: ${JSON.stringify({ step: 'connected', progress: 0, message: 'Connected to progress stream' })}\n\n`);

  // Clean up on client disconnect
  req.on('close', () => {
    activeConnections.delete(sessionId);
  });
});

app.post("/generate-readme", async (req, res) => {
  try {
    const { repoUrl, sessionId } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: "Repository URL is required" });
    }

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) {
      return res.status(400).json({ error: "Invalid GitHub URL format" });
    }

    // Progress callback function
    const progressCallback = (data) => {
      if (sessionId && activeConnections.has(sessionId)) {
        const connection = activeConnections.get(sessionId);
        connection.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    // Start progress updates
    progressCallback({
      step: 'fetching',
      progress: 10,
      message: 'Fetching repository data...',
      estimatedTime: 60
    });

    // Get repo data
    const repoData = await makeRequest(`${GITHUB_API}/repos/${repoInfo.owner}/${repoInfo.repo}`);
    
    progressCallback({
      step: 'analyzing',
      progress: 20,
      message: 'Scanning repository files...',
      estimatedTime: 50
    });

    // Get files with progress updates
    const files = await fetchRepoFiles(repoInfo.owner, repoInfo.repo, "", 0, progressCallback);

    if (files.length === 0) {
      throw new Error("No accessible files found in repository");
    }

    progressCallback({
      step: 'analyzing',
      progress: 55,
      message: 'Repository scan complete',
      estimatedTime: 40
    });

    // Generate README with progress updates
    const readme = await generateReadme(repoInfo, files, repoData, progressCallback);
    const analysis = await analyzeRepository(files, repoData);

    // Final progress update
    progressCallback({
      step: 'complete',
      progress: 100,
      message: 'README generated successfully!',
      estimatedTime: 0
    });

    // Close the progress stream
    setTimeout(() => {
      if (sessionId && activeConnections.has(sessionId)) {
        const connection = activeConnections.get(sessionId);
        connection.end();
        activeConnections.delete(sessionId);
      }
    }, 1000);

    res.json({
      readme,
      analysis: {
        ...analysis,
        summary: {
          totalFiles: analysis.totalFiles,
          primaryLanguage: analysis.primaryLanguage,
          projectComplexity: analysis.totalFiles > 100 ? 'Complex' : 
                            analysis.totalFiles > 20 ? 'Moderate' : 'Simple'
        }
      },
      model: "gemini-2.0-flash-exp",
      repository: {
        name: repoData.full_name,
        description: repoData.description,
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        language: repoData.language,
        size: repoData.size,
        lastUpdated: repoData.updated_at,
        createdAt: repoData.created_at
      }
    });

  } catch (error) {
    console.error('Generation failed:', error.message);
    
    // Send error through progress stream
    if (req.body.sessionId && activeConnections.has(req.body.sessionId)) {
      const connection = activeConnections.get(req.body.sessionId);
      connection.write(`data: ${JSON.stringify({ step: 'error', progress: 0, message: error.message })}\n\n`);
      connection.end();
      activeConnections.delete(req.body.sessionId);
    }
    
    const status = error.message.includes('not found') ? 404 : 
                   error.message.includes('Rate limit') ? 429 : 500;
    res.status(status).json({ 
      error: error.message,
      details: error.message.includes('not found') ? 
        'Repository not found or not accessible' : 
        error.message.includes('Rate limit') ? 
        'GitHub API rate limit exceeded' : 
        'Internal server error'
    });
  }
});

app.get("/health", async (req, res) => {
  try {
    // Test GitHub API connectivity
    const githubTest = process.env.GITHUB_TOKEN ? 
      await makeRequest(`${GITHUB_API}/user`).then(() => true).catch(() => false) : 
      false;

    // Test Gemini API connectivity
    const geminiTest = process.env.GEMINI_API_KEY ? 
      await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "test" }] }]
        })
      }).then(r => r.ok).catch(() => false) : 
      false;

    res.json({
      status: "healthy",
      environment: {
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasGithubToken: !!process.env.GITHUB_TOKEN,
        port: PORT,
        nodeEnv: process.env.NODE_ENV || 'development'
      },
      connectivity: {
        github: githubTest ? 'connected' : 'failed',
        gemini: geminiTest ? 'connected' : 'failed'
      },
      model: "gemini-2.0-flash-exp",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableRoutes: [
      'GET /',
      'GET /health',
      'GET /test-gemini',
      'POST /generate-readme',
      'GET /progress/:sessionId'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Using Gemini 2.0 Flash model`);
  console.log(`🔑 GitHub Token: ${process.env.GITHUB_TOKEN ? '✅ Active' : '❌ Missing'}`);
  console.log(`🔑 Gemini Key: ${process.env.GEMINI_API_KEY ? '✅ Active' : '❌ Missing'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;