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

// Helper function to get the correct redirect URI
const getRedirectUri = () => {
  // Use explicit OAUTH_CALLBACK_URL if provided
  if (process.env.OAUTH_CALLBACK_URL) {
    return process.env.OAUTH_CALLBACK_URL;
  }
  
  // Otherwise construct from APP_URL
  if (process.env.APP_URL) {
    return `${process.env.APP_URL}/auth/callback`;
  }
  
  // Default for development
  return 'http://localhost:5000/auth/callback';
};

// Helper function to get the correct base URL
const getBaseUrl = (req) => {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  
  // For production, construct from request headers
  if (process.env.NODE_ENV === 'production') {
    const protocol = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const host = req.get('x-forwarded-host') || req.get('host');
    return `${protocol}://${host}`;
  }
  
  // Default for development
  return 'http://localhost:5000';
};

// Middleware
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
  resave: false, 
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: [
    /localhost:\d+/, 
    /\.vercel\.app$/, 
    /\.netlify\.app$/,
    /\.onrender\.com$/
  ],
  credentials: true, 
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Trust proxy for production
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

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
            { accessible: false, error: 'REPO_INVALID', isPrivate: false, isPublic: false, accessLevel: 'invalid', requiresAuth: false, message: 'Repository does not exist or you do not have access' } :
            { accessible: false, error: tokenError.message, isPrivate: true, isPublic: false, accessLevel: 'private_no_access', requiresAuth: false, message: 'Private repository - access denied' };
        }
      } else {
        return { accessible: false, error: 'REPO_PRIVATE_OR_INVALID', isPrivate: null, isPublic: false, accessLevel: 'unknown', requiresAuth: true, message: 'Repository not found. It might be private or invalid. Please login to access private repositories.' };
      }
    }
    return { accessible: false, error: error.message, isPrivate: error.message === 'REPO_PRIVATE', isPublic: false, accessLevel: error.message === 'REPO_PRIVATE' ? 'private_needs_auth' : 'error', requiresAuth: error.message === 'REPO_PRIVATE' || error.message === 'AUTH_REQUIRED', message: error.message === 'REPO_PRIVATE' ? 'Private repository - authentication required' : 'Repository access error' };
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

const extractCodeSnippets = (code, filename, maxLines = 300) => {
  if (!code) return '';
  const lines = code.split('\n');
  if (lines.length <= maxLines) return code;
  
  if (['package.json', 'requirements.txt', 'Dockerfile', '.env.example', 'docker-compose.yml'].includes(filename)) {
    return lines.slice(0, Math.min(150, lines.length)).join('\n');
  }
  
  let importantLines = lines.map((line, index) => {
    const trimmed = line.trim();
    let priority = 0;
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) priority = 1;
    else if (trimmed.match(/^(import|export|from|class\s+\w+|def\s+\w+|function\s+\w+|const\s+\w+\s*=.*=>|app\.|router\.|server\.)/)) priority = 15;
    else if (trimmed.match(/(\.get\(|\.post\(|\.put\(|\.delete\(|\.patch\(|\.use\(|\.listen\(|\.connect\(|mongoose\.|Schema\()/)) priority = 12;
    else if (trimmed.match(/(if\s*\(|for\s*\(|while\s*\(|try\s*{|catch\s*\(|async\s+|await\s+|return\s+)/)) priority = 9;
    else if (trimmed.match(/(const\s+|let\s+|var\s+|module\.exports|exports\.|require\()/)) priority = 7;
    else if (trimmed.length > 0) priority = 5;
    return { line, index, priority, original: line };
  });
  
  importantLines.sort((a, b) => b.priority - a.priority);
  const selectedLines = importantLines.slice(0, maxLines);
  selectedLines.sort((a, b) => a.index - b.index);
  return selectedLines.map(item => item.original).join('\n');
};

const analyzeJavaScriptCode = (code, filename) => {
  const analysis = { filename, type: 'javascript', functions: [], imports: [], exports: [], classes: [], apis: [], frameworks: [], features: [], businessLogic: [], codeSnippets: extractCodeSnippets(code, filename) };

  try {
    const ast = babelParser.parse(code, { sourceType: 'module', allowImportExportEverywhere: true, plugins: ['jsx', 'typescript', 'decorators-legacy'] });
    const frameworks = { react: 'React', express: 'Express.js', mongoose: 'MongoDB/Mongoose', 'socket.io': 'Socket.IO', jwt: 'JWT Authentication', bcrypt: 'Password Encryption', multer: 'File Upload', nodemailer: 'Email', cors: 'CORS', 'body-parser': 'Body Parser', axios: 'HTTP Client', lodash: 'Utilities', moment: 'Date Handling', dotenv: 'Environment Variables', helmet: 'Security', morgan: 'Logging' };
    const features = { auth: 'Authentication System', login: 'Login System', signup: 'Registration System', upload: 'File Upload', email: 'Email System', mail: 'Email System', payment: 'Payment Processing', stripe: 'Stripe Integration', search: 'Search Functionality', filter: 'Filtering System', validate: 'Validation System', middleware: 'Middleware System', hash: 'Password Hashing', token: 'Token Management' };

    traverse.default(ast, {
      ImportDeclaration(path) {
        const source = path.node.source.value;
        const imports = path.node.specifiers.map(spec => spec.local.name);
        analysis.imports.push({ from: source, imports });
        Object.entries(frameworks).forEach(([key, value]) => {
          if (source.includes(key) && !analysis.frameworks.includes(value)) analysis.frameworks.push(value);
        });
      },
      FunctionDeclaration(path) {
        const name = path.node.id.name;
        const params = path.node.params.map(param => param.name || 'param');
        analysis.functions.push({ name, parameters: params, async: path.node.async });
        Object.entries(features).forEach(([key, value]) => {
          if (name.toLowerCase().includes(key) && !analysis.features.includes(value)) {
            analysis.features.push(value);
            analysis.businessLogic.push(`${value}: ${name}(${params.join(', ')})`);
          }
        });
      },
      CallExpression(path) {
        if (path.node.callee.property && ['get', 'post', 'put', 'delete', 'patch', 'use'].includes(path.node.callee.property.name)) {
          const method = path.node.callee.property.name.toUpperCase();
          const route = path.node.arguments[0]?.value || path.node.arguments[0]?.raw || 'dynamic';
          analysis.apis.push({ method, route });
          analysis.businessLogic.push(`API Endpoint: ${method} ${route}`);
        }
      },
      ClassDeclaration(path) {
        const name = path.node.id.name;
        const methods = path.node.body.body.filter(node => node.type === 'MethodDefinition').map(method => method.key.name);
        analysis.classes.push({ name, methods });
        analysis.businessLogic.push(`Class: ${name} with methods: ${methods.join(', ')}`);
      }
    });
  } catch (error) {
    return analyzeCodeWithRegex(code, filename);
  }
  return analysis;
};

const analyzePythonCode = (code, filename) => {
  const analysis = { filename, type: 'python', imports: [], functions: [], classes: [], apis: [], frameworks: [], features: [], businessLogic: [], codeSnippets: extractCodeSnippets(code, filename) };
  const frameworks = { django: 'Django', flask: 'Flask', fastapi: 'FastAPI', tensorflow: 'TensorFlow', torch: 'PyTorch', pandas: 'Data Analysis', numpy: 'NumPy', matplotlib: 'Data Visualization', requests: 'HTTP Client', sqlalchemy: 'SQLAlchemy ORM', redis: 'Redis Cache', celery: 'Task Queue' };
  const features = { auth: 'Authentication System', login: 'Login System', predict: 'Machine Learning', train: 'ML Training', model: 'ML Model', process: 'Data Processing', analyze: 'Data Analysis', scrape: 'Web Scraping' };

  (code.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)$/gm) || []).forEach(match => {
    analysis.imports.push(match.trim());
    Object.entries(frameworks).forEach(([key, value]) => {
      if (match.includes(key) && !analysis.frameworks.includes(value)) analysis.frameworks.push(value);
    });
  });

  (code.match(/^def\s+(\w+)\s*\((.*?)\):/gm) || []).forEach(match => {
    const [, name, params] = match.match(/def\s+(\w+)\s*\((.*?)\):/) || [];
    analysis.functions.push({ name, parameters: params ? params.split(',').map(p => p.trim()) : [] });
    Object.entries(features).forEach(([key, value]) => {
      if (name.toLowerCase().includes(key) && !analysis.features.includes(value)) {
        analysis.features.push(value);
        analysis.businessLogic.push(`${value}: ${name}()`);
      }
    });
  });

  (code.match(/^class\s+(\w+).*?:/gm) || []).forEach(match => {
    const [, name] = match.match(/class\s+(\w+)/) || [];
    analysis.classes.push({ name });
    analysis.businessLogic.push(`Class: ${name}`);
  });

  return analysis;
};

const analyzeCodeWithRegex = (code, filename) => {
  const analysis = { filename, type: 'unknown', patterns: [], features: [], businessLogic: [], codeSnippets: extractCodeSnippets(code, filename) };
  const patterns = { 'Authentication': /auth|login|password|jwt|token|session/gi, 'Database': /database|db|sql|mongo|postgres|mysql/gi, 'API': /api|endpoint|route|rest|graphql/gi, 'File Upload': /upload|multer|file|attachment/gi, 'Email': /email|mail|smtp|nodemailer/gi, 'Payment': /payment|stripe|paypal|billing/gi, 'Machine Learning': /tensorflow|torch|sklearn|model|predict/gi, 'Data Processing': /pandas|numpy|data|process|analyze/gi };

  Object.entries(patterns).forEach(([feature, regex]) => {
    const matches = code.match(regex);
    if (matches && matches.length > 2) {
      analysis.features.push(feature);
      analysis.businessLogic.push(`${feature}: Found ${matches.length} references`);
    }
  });
  return analysis;
};

const selectImportantFiles = (files) => {
  const priorities = { 'package.json': 25, 'requirements.txt': 25, 'app.js': 22, 'main.js': 22, 'index.js': 22, 'server.js': 22, 'app.py': 22, 'main.py': 22, 'routes.js': 18, 'api.js': 18, 'config.js': 15, 'Dockerfile': 12, 'README.md': 8, '.env.example': 10, 'docker-compose.yml': 10 };
  
  return files.map(file => {
    let priority = priorities[file.name] || 0;
    if (file.name.includes('route') || file.name.includes('api')) priority += 15;
    if (file.name.includes('model') || file.name.includes('controller')) priority += 12;
    if (file.name.includes('service') || file.name.includes('utils')) priority += 10;
    if (file.name.includes('middleware') || file.name.includes('auth')) priority += 8;
    if (file.name.endsWith('.js') || file.name.endsWith('.py')) priority += 8;
    if (file.name.endsWith('.jsx') || file.name.endsWith('.ts')) priority += 8;
    if (file.name.endsWith('.vue') || file.name.endsWith('.component.js')) priority += 6;
    return { ...file, priority };
  }).sort((a, b) => b.priority - a.priority).slice(0, 50);
};

const performDeepCodeAnalysis = async (files, progressCallback) => {
  const importantFiles = selectImportantFiles(files);
  const codeAnalysis = [];
  let processedFiles = 0;
  
  progressCallback({ step: 'analyzing', progress: 25, message: 'Starting intelligent code analysis with content extraction...', estimatedTime: 60 });
  
  for (const file of importantFiles) {
    progressCallback({ step: 'analyzing', progress: 25 + Math.round((processedFiles / importantFiles.length) * 35), message: `Analyzing ${file.name} with AST parsing and content extraction...` });
    
    if (file.download_url && file.size < 1000000) {
      const content = await fetchFileContent(file.download_url, 500000);
      if (content) {
        let analysis;
        if (file.name.match(/\.(js|jsx|ts|tsx)$/)) analysis = analyzeJavaScriptCode(content, file.name);
        else if (file.name.endsWith('.py')) analysis = analyzePythonCode(content, file.name);
        else if (['package.json', 'requirements.txt', 'Dockerfile', '.env.example', 'docker-compose.yml'].includes(file.name)) {
          analysis = { filename: file.name, type: 'configuration', content: content.substring(0, 8000), codeSnippets: extractCodeSnippets(content, file.name), businessLogic: [`Configuration file: ${file.name}`] };
        } else analysis = analyzeCodeWithRegex(content, file.name);
        codeAnalysis.push(analysis);
      }
    }
    processedFiles++;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return codeAnalysis;
};

const generateSemanticAnalysis = (codeAnalysis) => {
  const semantic = { projectPurpose: '', mainFeatures: [], technicalStack: [], apiEndpoints: [], businessLogic: [], architecture: [], keyFunctionality: [] };
  const allFrameworks = new Set();
  const allFeatures = new Set();
  const allApis = [];
  const allBusinessLogic = [];
  
  codeAnalysis.forEach(analysis => {
    if (analysis.frameworks) analysis.frameworks.forEach(f => allFrameworks.add(f));
    if (analysis.features) analysis.features.forEach(f => allFeatures.add(f));
    if (analysis.apis) allApis.push(...analysis.apis);
    if (analysis.businessLogic) allBusinessLogic.push(...analysis.businessLogic);
    if (analysis.functions) analysis.functions.forEach(func => allBusinessLogic.push(`Function: ${func.name}(${func.parameters?.join(', ') || ''})`));
    if (analysis.classes) analysis.classes.forEach(cls => allBusinessLogic.push(`Class: ${cls.name}${cls.methods ? ` with methods: ${cls.methods.join(', ')}` : ''}`));
  });
  
  semantic.technicalStack = Array.from(allFrameworks);
  semantic.mainFeatures = Array.from(allFeatures);
  semantic.apiEndpoints = allApis;
  semantic.businessLogic = allBusinessLogic;
  
  if (semantic.technicalStack.includes('React')) semantic.projectPurpose = 'Frontend Web Application';
  else if (semantic.technicalStack.includes('Express.js') || semantic.technicalStack.includes('Django') || semantic.technicalStack.includes('Flask')) semantic.projectPurpose = 'Backend API Server';
  else if (semantic.technicalStack.includes('TensorFlow') || semantic.technicalStack.includes('PyTorch')) semantic.projectPurpose = 'Machine Learning Application';
  else if (allBusinessLogic.some(logic => logic.includes('API'))) semantic.projectPurpose = 'API Service';
  else if (semantic.technicalStack.includes('Data Analysis')) semantic.projectPurpose = 'Data Analysis Tool';
  else semantic.projectPurpose = 'Software Application';
  
  return semantic;
};

const fetchRepoFiles = async (owner, repo, path = "", depth = 0, progressCallback, userToken = null) => {
  if (depth > 3) return [];
  
  try {
    const items = await makeRequest(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {}, userToken);
    if (!Array.isArray(items)) return [];
    
    let files = [];
    const totalItems = Math.min(items.length, 150);
    
    for (let i = 0; i < totalItems; i++) {
      const item = items[i];
      
      if (progressCallback && depth === 0) {
        progressCallback({ step: 'fetching', progress: Math.round((i / totalItems) * 20), message: `Scanning repository structure... (${i + 1}/${totalItems})` });
      }
      
      if (item.type === "file" && item.size < 2 * 1024 * 1024) {
        files.push({ name: item.name, path: item.path, size: item.size || 0, download_url: item.download_url });
      } else if (item.type === "dir" && depth < 3 && !item.name.startsWith('.') && !['node_modules', 'vendor', 'dist', 'build', '__pycache__', '.git'].includes(item.name)) {
        const subFiles = await fetchRepoFiles(owner, repo, item.path, depth + 1, progressCallback, userToken);
        files = files.concat(subFiles);
      }
      
      if (i % 15 === 0) await new Promise(resolve => setTimeout(resolve, 30));
    }
    return files;
  } catch (error) {
    if (depth === 0) throw error;
    return [];
  }
};

const generateIntelligentReadme = async (repoInfo, repoData, semanticAnalysis, codeAnalysis, progressCallback) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  progressCallback({ step: 'generating', progress: 70, message: 'Generating intelligent README with comprehensive code analysis...', estimatedTime: 30 });

  const prompt = `You are analyzing a codebase to create an accurate README. Based on the ACTUAL CODE CONTENT below, determine what this project does and create a comprehensive README.

**REPOSITORY INFO:**
- Name: ${repoData.full_name}
- Description: ${repoData.description || 'No description provided'}
- Primary Language: ${repoData.language || 'Multiple'}
- Stars: ${repoData.stargazers_count}
- Last Updated: ${repoData.updated_at}

**ACTUAL CODE ANALYSIS:**
${codeAnalysis.map(analysis => {
  let section = `\n=== ${analysis.filename} ===\n`;
  if (analysis.codeSnippets) section += `ACTUAL CODE (${analysis.codeSnippets.split('\n').length} lines):\n\`\`\`${analysis.type === 'javascript' ? 'javascript' : analysis.type === 'python' ? 'python' : ''}\n${analysis.codeSnippets}\n\`\`\`\n`;
  if (analysis.content) section += `CONFIGURATION CONTENT:\n\`\`\`json\n${analysis.content}\n\`\`\`\n`;
  if (analysis.functions && analysis.functions.length > 0) section += `FUNCTIONS FOUND:\n${analysis.functions.map(f => `- ${f.async ? 'async ' : ''}${f.name}(${f.parameters?.join(', ') || ''})`).join('\n')}\n`;
  if (analysis.classes && analysis.classes.length > 0) section += `CLASSES FOUND:\n${analysis.classes.map(c => `- ${c.name}${c.methods ? ` [methods: ${c.methods.join(', ')}]` : ''}`).join('\n')}\n`;
  if (analysis.apis && analysis.apis.length > 0) section += `API ENDPOINTS FOUND:\n${analysis.apis.map(api => `- ${api.method} ${api.route}`).join('\n')}\n`;
  if (analysis.imports && analysis.imports.length > 0) section += `IMPORTS/DEPENDENCIES:\n${analysis.imports.slice(0, 10).map(imp => typeof imp === 'object' ? `- ${imp.from}: [${imp.imports.join(', ')}]` : `- ${imp}`).join('\n')}\n`;
  if (analysis.frameworks && analysis.frameworks.length > 0) section += `FRAMEWORKS DETECTED: ${analysis.frameworks.join(', ')}\n`;
  return section;
}).join('\n')}

**SEMANTIC ANALYSIS SUMMARY:**
- Project Purpose: ${semanticAnalysis.projectPurpose}
- Technical Stack: ${semanticAnalysis.technicalStack.join(', ')}
- Main Features Detected: ${semanticAnalysis.mainFeatures.join(', ')}
- Total API Endpoints: ${semanticAnalysis.apiEndpoints.length}
- Business Logic Components: ${semanticAnalysis.businessLogic.slice(0, 15).join(', ')}

**CRITICAL INSTRUCTIONS:**
1. Analyze the ACTUAL CODE SNIPPETS provided above - these are real code from the repository
2. Create a title based on what the code actually does, not the repository name
3. Describe functionality based on the actual functions, classes, API routes, and imports you can see
4. Only mention features that are clearly evident in the code analysis
5. If you see Express.js routes with specific endpoints, describe those exact endpoints
6. If you see React components, describe the UI functionality
7. If you see database schemas/models, describe the data structure
8. If you see authentication middleware, describe the auth system
9. Be specific about technical implementation details you can observe

**README STRUCTURE:**
# [Descriptive Project Title Based on Actual Functionality]

## Overview
Explain what this project does based on the actual code analysis. Be specific about the functionality you can see implemented.

## Features
List ONLY features that are clearly evident from the code analysis. For each feature, briefly explain what you found in the code.

## Tech Stack
List the exact technologies detected from imports and code analysis.

## Project Structure
Describe the architecture based on the files analyzed and their relationships.

## API Documentation
(Include this section ONLY if actual API endpoints were found. List the real endpoints discovered)

## Installation
Provide installation steps based on the package.json, requirements.txt, or other config files found.

## Usage
Show how to use the application based on the main entry points and functionality discovered.

## Configuration
(Only include if environment variables or config files were found in the analysis)

## Contributing
Standard contribution guidelines.

## License
Standard license section.

**WRITING STYLE:**
- Write in first person as the project creator ("I built this...", "This project provides...")
- Be technical but accessible
- Focus on what the application does, not file organization
- Use specific examples from the code when possible
- Don't mention "repository structure" or "files contain" - focus on functionality

Return ONLY the markdown content without any wrapper text.`;

  progressCallback({ step: 'generating', progress: 85, message: 'AI processing comprehensive code analysis...', estimatedTime: 15 });

  const response = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.9, maxOutputTokens: 4500 }
    })
  });

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
  const data = await response.json();
  const readme = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!readme) throw new Error('No content generated by Gemini API');
  return readme.replace(/^```(?:markdown)?\s*/i, '').replace(/```$/, '').trim();
};

// Routes
app.get("/", (req, res) => res.json({
  message: "Fixed README Generator v5.3 with Proper OAuth Configuration",
  endpoints: ["/health", "/test-gemini", "/generate-readme", "/auth/github", "/auth/callback", "/auth/user", "/auth/logout"],
  model: "gemini-2.0-flash-exp", 
  features: ["Fixed OAuth redirect URI handling", "Proper environment variable usage", "Enhanced error logging", "Fixed AST parsing", "300-line code snippets", "Accurate semantic analysis", "Proper private/public repo detection", "Enhanced business logic detection", "Intelligent file prioritization"],
  redirectUri: getRedirectUri()
}));

// FIXED OAuth routes with consistent redirect URI handling
app.get("/auth/github", (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  
  // Use the dedicated redirect URI function
  const redirectUri = getRedirectUri();
  
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'repo', 
    state
  });
  
  console.log('OAuth redirect URI:', redirectUri);
  console.log('Full OAuth URL:', `${GITHUB_OAUTH_URL}?${params}`);
  
  res.redirect(`${GITHUB_OAUTH_URL}?${params}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  
  if (!state || state !== req.session.oauthState) {
    console.log('OAuth state mismatch:', { received: state, expected: req.session.oauthState });
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=invalid_state`);
  }
  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=access_denied`);
  }
  
  try {
    // Use the same redirect URI function for consistency
    const redirectUri = getRedirectUri();
    
    console.log('Token exchange redirect URI:', redirectUri);
    
    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST', 
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID, 
        client_secret: process.env.GITHUB_CLIENT_SECRET, 
        code,
        redirect_uri: redirectUri
      })
    });
    
    const tokenData = await tokenResponse.json();
    if (tokenData.error) {
      console.error('GitHub OAuth error:', tokenData);
      throw new Error(tokenData.error_description || tokenData.error);
    }
    
    const userResponse = await fetch(`${GITHUB_API}/user`, {
      headers: { 
        'Authorization': `Bearer ${tokenData.access_token}`, 
        'Accept': 'application/vnd.github.v3+json' 
      }
    });
    const userData = await userResponse.json();
    
    req.session.github = {
      accessToken: tokenData.access_token,
      user: { 
        id: userData.id, 
        login: userData.login, 
        name: userData.name, 
        avatar_url: userData.avatar_url 
      }
    };
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    console.log('Redirecting to frontend:', `${frontendUrl}?auth=success`);
    res.redirect(`${frontendUrl}?auth=success`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}?error=oauth_failed`);
  }
});

app.get("/auth/user", (req, res) => {
  res.json(req.session.github ? { 
    authenticated: true, 
    user: req.session.github.user 
  } : { 
    authenticated: false, 
    user: null 
  });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true });
  });
});

app.post("/check-repo", async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) return res.status(400).json({ error: "Repository URL is required" });

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) return res.status(400).json({ error: "Invalid GitHub URL format" });

    const userToken = req.session.github?.accessToken;
    const accessCheck = await checkRepoAccess(repoInfo.owner, repoInfo.repo, userToken);

    res.json({ 
      ...accessCheck, 
      repoInfo, 
      userAuthenticated: !!req.session.github, 
      canGenerate: accessCheck.accessible, 
      needsAuth: accessCheck.requiresAuth && !userToken 
    });
  } catch (error) {
    console.error('Check repo error:', error);
    res.status(500).json({ 
      error: 'Failed to check repository access', 
      details: error.message, 
      accessible: false, 
      requiresAuth: false 
    });
  }
});

app.get("/test-gemini", async (req, res) => {
  try {
    const response = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ 
          parts: [{ 
            text: "Hello! Respond with 'Fixed README generator with accurate code analysis working!'" 
          }] 
        }] 
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
    console.error('Gemini test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/progress/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  
  res.writeHead(200, { 
    'Content-Type': 'text/event-stream', 
    'Cache-Control': 'no-cache', 
    'Connection': 'keep-alive', 
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  activeConnections.set(sessionId, res);
  res.write(`data: ${JSON.stringify({ 
    step: 'connected', 
    progress: 0, 
    message: 'Connected to fixed code analysis stream with accurate repository detection' 
  })}\n\n`);

  req.on('close', () => {
    activeConnections.delete(sessionId);
  });
});

app.post("/generate-readme", async (req, res) => {
  try {
    const { repoUrl, sessionId } = req.body;
    if (!repoUrl) return res.status(400).json({ error: "Repository URL is required" });

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) return res.status(400).json({ error: "Invalid GitHub URL format" });

    const userToken = req.session.github?.accessToken;

    const progressCallback = (data) => {
      if (sessionId && activeConnections.has(sessionId)) {
        const connection = activeConnections.get(sessionId);
        try {
          connection.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
          console.error('Progress callback error:', error);
          activeConnections.delete(sessionId);
        }
      }
    };

    progressCallback({ 
      step: 'initializing', 
      progress: 5, 
      message: 'Initializing fixed code analysis with accurate repository detection...', 
      estimatedTime: 120 
    });

    const accessCheck = await checkRepoAccess(repoInfo.owner, repoInfo.repo, userToken);
    
    if (!accessCheck.accessible) {
      if (accessCheck.requiresAuth && !userToken) throw new Error('AUTH_REQUIRED');
      throw new Error(accessCheck.error || accessCheck.message || 'Repository not accessible');
    }

    const repoData = accessCheck.repoData;
    progressCallback({ 
      step: 'fetching', 
      progress: 10, 
      message: `Scanning ${accessCheck.isPrivate ? 'private' : 'public'} repository structure...`, 
      estimatedTime: 110 
    });

    const files = await fetchRepoFiles(repoInfo.owner, repoInfo.repo, "", 0, progressCallback, userToken);
    if (files.length === 0) throw new Error("No accessible files found in repository");

    progressCallback({ 
      step: 'analyzing', 
      progress: 25, 
      message: 'Starting comprehensive code analysis with 300-line extraction...', 
      estimatedTime: 90 
    });

    const codeAnalysis = await performDeepCodeAnalysis(files, progressCallback);
    
    progressCallback({ 
      step: 'analyzing', 
      progress: 60, 
      message: 'Generating semantic analysis from extracted code...', 
      estimatedTime: 50 
    });

    const semanticAnalysis = generateSemanticAnalysis(codeAnalysis);
    
    progressCallback({ 
      step: 'generating', 
      progress: 70, 
      message: 'Creating intelligent README based on comprehensive analysis...', 
      estimatedTime: 40 
    });

    const readme = await generateIntelligentReadme(repoInfo, repoData, semanticAnalysis, codeAnalysis, progressCallback);

    progressCallback({ 
      step: 'complete', 
      progress: 100, 
      message: 'Fixed README generated successfully with accurate analysis!', 
      estimatedTime: 0 
    });

    // Close SSE connection after a delay
    setTimeout(() => {
      if (sessionId && activeConnections.has(sessionId)) {
        activeConnections.get(sessionId).end();
        activeConnections.delete(sessionId);
      }
    }, 1000);

    res.json({
      readme,
      analysis: {
        totalFiles: files.length, 
        analyzedFiles: codeAnalysis.length, 
        primaryLanguage: repoData.language, 
        projectPurpose: semanticAnalysis.projectPurpose, 
        technicalStack: semanticAnalysis.technicalStack, 
        mainFeatures: semanticAnalysis.mainFeatures, 
        apiEndpoints: semanticAnalysis.apiEndpoints.length, 
        businessLogicItems: semanticAnalysis.businessLogic.length, 
        intelligenceLevel: 'Fixed AST + 300-line Code Snippets + Accurate Semantic Analysis',
        codeSnippetsExtracted: codeAnalysis.filter(a => a.codeSnippets).length,
        totalCodeLines: codeAnalysis.reduce((total, analysis) => total + (analysis.codeSnippets ? analysis.codeSnippets.split('\n').length : 0), 0),
        repositoryType: accessCheck.accessLevel
      },
      semanticAnalysis: {
        projectPurpose: semanticAnalysis.projectPurpose, 
        technicalStack: semanticAnalysis.technicalStack,
        mainFeatures: semanticAnalysis.mainFeatures, 
        businessLogic: semanticAnalysis.businessLogic.slice(0, 25),
        apiEndpoints: semanticAnalysis.apiEndpoints.slice(0, 20), 
        keyFunctionality: semanticAnalysis.keyFunctionality
      },
      codeAnalysisDetails: codeAnalysis.map(analysis => ({
        filename: analysis.filename, 
        type: analysis.type, 
        functionsFound: analysis.functions?.length || 0, 
        classesFound: analysis.classes?.length || 0, 
        importsFound: analysis.imports?.length || 0, 
        apisFound: analysis.apis?.length || 0, 
        featuresDetected: analysis.features?.length || 0,
        hasCodeSnippets: !!analysis.codeSnippets, 
        codeSnippetLines: analysis.codeSnippets ? analysis.codeSnippets.split('\n').length : 0
      })),
      model: "gemini-2.0-flash-exp",
      repository: {
        name: repoData.full_name, 
        description: repoData.description, 
        stars: repoData.stargazers_count, 
        forks: repoData.forks_count, 
        language: repoData.language, 
        size: repoData.size, 
        private: repoData.private,
        lastUpdated: repoData.updated_at, 
        createdAt: repoData.created_at, 
        accessLevel: accessCheck.accessLevel
      },
      user: req.session.github?.user || null
    });

  } catch (error) {
    console.error('Generate README error:', error);
    
    // Send error through SSE if available
    if (req.body.sessionId && activeConnections.has(req.body.sessionId)) {
      const connection = activeConnections.get(req.body.sessionId);
      try {
        connection.write(`data: ${JSON.stringify({ 
          step: 'error', 
          progress: 0, 
          message: error.message 
        })}\n\n`);
        connection.end();
      } catch (sseError) {
        console.error('SSE error send failed:', sseError);
      }
      activeConnections.delete(req.body.sessionId);
    }
    
    if (error.message === 'AUTH_REQUIRED') {
      return res.status(401).json({ 
        error: 'Authentication required for repository access', 
        requiresAuth: true, 
        details: 'This repository might be private or requires authentication for comprehensive analysis' 
      });
    }
    
    const status = error.message.includes('not found') || error.message.includes('REPO_INVALID') ? 404 : 
                   error.message.includes('Rate limit') ? 429 : 
                   error.message.includes('REPO_PRIVATE') ? 403 : 500;
                   
    res.status(status).json({ 
      error: error.message,
      details: error.message.includes('not found') || error.message.includes('REPO_INVALID') ? 
        'Repository does not exist or is not accessible' : 
        error.message.includes('Rate limit') ? 
        'GitHub API rate limit exceeded. Please try again later.' : 
        error.message.includes('REPO_PRIVATE') ? 
        'Private repository requires authentication' : 
        'Code analysis failed. Please try again.'
    });
  }
});

app.get("/health", async (req, res) => {
  try {
    const githubTest = process.env.GITHUB_TOKEN ? 
      await makeRequest(`${GITHUB_API}/user`).then(() => true).catch(() => false) : false;
    
    const geminiTest = process.env.GEMINI_API_KEY ? 
      await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] })
      }).then(r => r.ok).catch(() => false) : false;

    res.json({
      status: "healthy", 
      version: "5.3-oauth-fixed",
      capabilities: { 
        fixedOAuthRedirectURI: true,
        properEnvironmentVariableUsage: true,
        enhancedErrorLogging: true,
        fixedAstCodeParsing: true, 
        accurateSemanticAnalysis: true, 
        properRepoDetection: true, 
        businessLogicDetection: true, 
        intelligentFilePrioritization: true, 
        jsAstAnalysis: true, 
        pythonCodeAnalysis: true, 
        enhancedCodeSnippets: true, 
        upTo300LineAnalysis: true, 
        publicPrivateRepoDistinction: true
      },
      environment: { 
        hasGeminiKey: !!process.env.GEMINI_API_KEY, 
        hasGithubToken: !!process.env.GITHUB_TOKEN, 
        hasGithubOAuth: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET), 
        hasAppUrl: !!process.env.APP_URL,
        hasOAuthCallbackUrl: !!process.env.OAUTH_CALLBACK_URL,
        hasFrontendUrl: !!process.env.FRONTEND_URL,
        port: PORT, 
        nodeEnv: process.env.NODE_ENV || 'development',
        redirectUri: getRedirectUri()
      },
      connectivity: { 
        github: githubTest ? 'connected' : 'failed', 
        gemini: geminiTest ? 'connected' : 'failed' 
      },
      model: "gemini-2.0-flash-exp", 
      analysisEngine: "Fixed Babel AST + 300-line Code Snippets + Accurate Repository Detection",
      codeAnalysisFeatures: { 
        maxCodeLinesPerFile: 300, 
        maxFileSize: "1MB", 
        enhancedContentExtraction: true, 
        intelligentSnippetSelection: true, 
        frameworkDetection: true, 
        businessLogicAnalysis: true, 
        properErrorHandling: true, 
        accurateRepoTypeDetection: true 
      },
      fixes: [
        "Fixed OAuth redirect URI to use consistent getRedirectUri() function",
        "Added support for OAUTH_CALLBACK_URL environment variable",
        "Enhanced OAuth error logging and debugging",
        "Fixed code analysis not reading actual code content", 
        "Added proper public/private/invalid repository distinction", 
        "Enhanced error handling and logging", 
        "Improved AST parsing with better error recovery", 
        "Fixed semantic analysis generation"
      ],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: "unhealthy", 
      error: error.message, 
      timestamp: new Date().toISOString() 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: error.message, 
    timestamp: new Date().toISOString() 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found', 
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableRoutes: [
      'GET /', 
      'GET /health', 
      'GET /test-gemini', 
      'POST /generate-readme', 
      'POST /check-repo', 
      'GET /auth/github', 
      'GET /auth/callback', 
      'GET /auth/user', 
      'POST /auth/logout', 
      'GET /progress/:sessionId'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Fixed README Generator v5.3 running on port ${PORT}`);
  console.log(`🔧 OAUTH FIX: Consistent redirect URI handling with getRedirectUri() function`);
  console.log(`🔗 OAuth Redirect URI: ${getRedirectUri()}`);
  console.log(`🔒 Session handling optimized for production deployments`);
  console.log(`🧠 Enhanced AST-powered code analysis with up to 300 lines per file`);
  console.log(`📊 Accurate semantic analysis with comprehensive business logic detection`);
  console.log(`📝 Code Analysis: Up to 300 lines per file, 1MB file size limit, 50 priority files`);
  console.log(`🔑 GitHub Token: ${process.env.GITHUB_TOKEN ? '✅ Active' : '❌ Missing'}`);
  console.log(`🔑 GitHub OAuth: ${process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🔑 Gemini Key: ${process.env.GEMINI_API_KEY ? '✅ Active' : '❌ Missing'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 App URL: ${process.env.APP_URL || 'Auto-detected from request headers'}`);
  console.log(`🔗 OAuth Callback URL: ${process.env.OAUTH_CALLBACK_URL || 'Constructed from APP_URL'}`);
  console.log(`🎯 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`🔧 OAuth Fix: Dedicated getRedirectUri() function for consistent URL handling`);
});

export default app;