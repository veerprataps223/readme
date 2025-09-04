import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const GITHUB_API = "https://api.github.com";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

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

// Create HTTP server and WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Store WebSocket connections
const connections = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const sessionId = req.url.split('sessionId=')[1];
  if (sessionId) {
    connections.set(sessionId, ws);
    console.log(`WebSocket connected for session: ${sessionId}`);
    
    ws.on('close', () => {
      connections.delete(sessionId);
      console.log(`WebSocket disconnected for session: ${sessionId}`);
    });
  }
});

// Function to send progress updates
const sendProgress = (sessionId, progress) => {
  const ws = connections.get(sessionId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'progress', data: progress }));
  }
};

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

const fetchRepoFiles = async (owner, repo, sessionId, path = "", depth = 0) => {
  if (depth > 3) return [];
  
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  
  try {
    sendProgress(sessionId, { 
      step: 'fetching_files',
      message: `Scanning ${path || 'repository'}...`,
      progress: Math.min(20 + (depth * 10), 40)
    });
    
    const items = await makeRequest(url);
    if (!Array.isArray(items)) return [];
    
    let files = [];
    let processedItems = 0;
    const totalItems = Math.min(items.length, 100);
    
    for (const item of items.slice(0, 100)) {
      if (item.type === "file" && item.size < 1024 * 1024) {
        files.push({
          name: item.name,
          path: item.path,
          size: item.size || 0,
          download_url: item.download_url
        });
      } else if (item.type === "dir" && depth < 2 && !item.name.startsWith('.') && 
                !['node_modules', 'vendor', 'dist', 'build', '__pycache__'].includes(item.name)) {
        const subFiles = await fetchRepoFiles(owner, repo, sessionId, item.path, depth + 1);
        files = files.concat(subFiles);
      }
      
      processedItems++;
      if (depth === 0) {
        sendProgress(sessionId, { 
          step: 'fetching_files',
          message: `Processing files (${processedItems}/${totalItems})...`,
          progress: 20 + ((processedItems / totalItems) * 20)
        });
      }
    }
    
    return files;
  } catch (error) {
    console.error(`Error fetching files from ${path}:`, error.message);
    if (depth === 0) throw error;
    return [];
  }
};

const generateReadme = async (repoInfo, files, repoData, sessionId) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  sendProgress(sessionId, { 
    step: 'analyzing',
    message: 'Analyzing repository structure...',
    progress: 50
  });

  // Simplified analysis - only count files and get primary language
  const analysis = {
    totalFiles: files.length,
    primaryLanguage: repoData.language || 'Unknown',
    filesProcessed: files.length
  };

  sendProgress(sessionId, { 
    step: 'generating',
    message: 'AI is generating your README...',
    progress: 70
  });

  // Create a comprehensive file structure for better README generation
  const fileStructure = files.map(file => ({
    name: file.name,
    path: file.path,
    type: file.name.includes('.') ? file.name.split('.').pop() : 'folder'
  }));

  const prompt = `Generate a comprehensive README.md for this GitHub repository:

**Repository:** ${repoData.full_name}
**Description:** ${repoData.description || 'No description provided'}
**Primary Language:** ${analysis.primaryLanguage}
**Stars:** ${repoData.stargazers_count || 0}
**Total Files:** ${analysis.totalFiles}
**File Structure:** ${JSON.stringify(fileStructure.slice(0, 50), null, 2)}

Create a professional README with these sections in order:
1. **Title** (# format with repository name)
2. **Description** (comprehensive overview based on files and structure)
3. **Features** (infer key functionality from file structure)
4. **Tech Stack** (technologies detected from file extensions and names)
5. **Installation** (setup instructions based on detected package managers)
6. **Usage** (how to use/run the project)
7. **API Documentation** (if applicable based on project type)
8. **Contributing** (contribution guidelines)
9. **License** (license information)

Make it engaging, professional, and include relevant badges. Use proper markdown formatting. Return ONLY markdown content without code blocks or delimiters.`;

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

  sendProgress(sessionId, { 
    step: 'finalizing',
    message: 'Finalizing README...',
    progress: 90
  });

  const data = await response.json();
  const readme = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!readme) {
    throw new Error('No content generated by Gemini API');
  }

  return {
    readme: readme.replace(/^``````$/, '').trim(),
    analysis
  };
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

app.post("/generate-readme", async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: "Repository URL is required" });
    }

    sendProgress(sessionId, { 
      step: 'parsing',
      message: 'Parsing repository URL...',
      progress: 5
    });

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) {
      return res.status(400).json({ error: "Invalid GitHub URL format" });
    }

    sendProgress(sessionId, { 
      step: 'fetching_repo',
      message: 'Fetching repository information...',
      progress: 10
    });

    // Get repo data and files
    const [repoData, files] = await Promise.all([
      makeRequest(`${GITHUB_API}/repos/${repoInfo.owner}/${repoInfo.repo}`),
      fetchRepoFiles(repoInfo.owner, repoInfo.repo, sessionId)
    ]);

    if (files.length === 0) {
      throw new Error("No accessible files found in repository");
    }

    sendProgress(sessionId, { 
      step: 'files_fetched',
      message: `Found ${files.length} files. Starting analysis...`,
      progress: 45
    });

    // Generate README with progress updates
    const result = await generateReadme(repoInfo, files, repoData, sessionId);

    sendProgress(sessionId, { 
      step: 'completed',
      message: 'README generated successfully!',
      progress: 100
    });

    res.json({
      readme: result.readme,
      analysis: {
        totalFiles: result.analysis.totalFiles,
        primaryLanguage: result.analysis.primaryLanguage,
        filesProcessed: result.analysis.filesProcessed,
        summary: {
          totalFiles: result.analysis.totalFiles,
          primaryLanguage: result.analysis.primaryLanguage,
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
    const status = error.message.includes('not found') ? 404 : 
                   error.message.includes('Rate limit') ? 429 : 500;
    
    sendProgress(sessionId, { 
      step: 'error',
      message: error.message,
      progress: 0,
      error: true
    });
    
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
    const githubTest = process.env.GITHUB_TOKEN ? 
      await makeRequest(`${GITHUB_API}/user`).then(() => true).catch(() => false) : 
      false;

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
      'POST /generate-readme'
    ]
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 WebSocket server ready`);
  console.log(`🤖 Using Gemini 2.0 Flash model`);
  console.log(`🔑 GitHub Token: ${process.env.GITHUB_TOKEN ? '✅ Active' : '❌ Missing'}`);
  console.log(`🔑 Gemini Key: ${process.env.GEMINI_API_KEY ? '✅ Active' : '❌ Missing'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
