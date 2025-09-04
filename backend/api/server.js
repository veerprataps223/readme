import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

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
    'https://readme-livid.vercel.app/',
    /\.vercel\.app$/,
    /\.netlify\.app$/,
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

// Enhanced repository analysis
async function analyzeRepository(files, repoData) {
  const analysis = {
    languages: new Map(), // Use Map to count occurrences
    technologies: new Set(),
    features: new Set(),
    projectType: 'Unknown',
    frameworks: new Set(),
    totalFiles: files.length,
    filesByType: new Map()
  };

  // Enhanced language detection with extension mapping
  const languageMap = {
    'js': 'JavaScript', 'jsx': 'JavaScript', 'mjs': 'JavaScript',
    'ts': 'TypeScript', 'tsx': 'TypeScript',
    'py': 'Python', 'pyw': 'Python', 'pyc': 'Python',
    'java': 'Java', 'jar': 'Java',
    'cpp': 'C++', 'cc': 'C++', 'cxx': 'C++', 'hpp': 'C++',
    'c': 'C', 'h': 'C',
    'cs': 'C#', 'csx': 'C#',
    'rb': 'Ruby', 'rbw': 'Ruby',
    'php': 'PHP', 'phtml': 'PHP',
    'go': 'Go',
    'rs': 'Rust',
    'swift': 'Swift',
    'kt': 'Kotlin', 'kts': 'Kotlin',
    'scala': 'Scala', 'sc': 'Scala',
    'r': 'R', 'rmd': 'R',
    'jl': 'Julia',
    'sh': 'Shell', 'bash': 'Shell', 'zsh': 'Shell',
    'vue': 'Vue.js',
    'svelte': 'Svelte',
    'dart': 'Dart',
    'html': 'HTML', 'htm': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS', 'sass': 'SASS',
    'less': 'LESS',
    'sql': 'SQL',
    'json': 'JSON',
    'xml': 'XML',
    'yaml': 'YAML', 'yml': 'YAML',
    'md': 'Markdown', 'markdown': 'Markdown'
  };

  // Technology detection patterns
  const techPatterns = {
    // Frontend Frameworks
    'React': [
      { type: 'dependency', patterns: ['react', '@types/react'] },
      { type: 'file', patterns: [/\.jsx$/, /\.tsx$/] },
      { type: 'content', patterns: [/import.*react/i, /from ['"]react['"]/i] }
    ],
    'Vue.js': [
      { type: 'dependency', patterns: ['vue', '@vue/'] },
      { type: 'file', patterns: [/\.vue$/] },
      { type: 'content', patterns: [/import.*vue/i] }
    ],
    'Angular': [
      { type: 'dependency', patterns: ['@angular/', 'angular'] },
      { type: 'file', patterns: ['angular.json', /\.component\./] }
    ],
    'Svelte': [
      { type: 'dependency', patterns: ['svelte'] },
      { type: 'file', patterns: [/\.svelte$/] }
    ],
    'Next.js': [
      { type: 'dependency', patterns: ['next'] },
      { type: 'file', patterns: ['next.config.js', 'next.config.ts'] }
    ],
    'Nuxt.js': [
      { type: 'dependency', patterns: ['nuxt'] },
      { type: 'file', patterns: ['nuxt.config.js', 'nuxt.config.ts'] }
    ],
    
    // Backend Frameworks
    'Node.js': [
      { type: 'file', patterns: ['package.json', 'server.js', 'app.js', 'index.js'] },
      { type: 'dependency', patterns: ['express', 'fastify', 'koa'] }
    ],
    'Express.js': [
      { type: 'dependency', patterns: ['express'] },
      { type: 'content', patterns: [/require\(['"]express['"]\)/, /from ['"]express['"]/] }
    ],
    'Django': [
      { type: 'file', patterns: ['manage.py', 'settings.py'] },
      { type: 'dependency', patterns: ['django'] }
    ],
    'Flask': [
      { type: 'dependency', patterns: ['flask'] },
      { type: 'content', patterns: [/from flask import/, /import flask/] }
    ],
    'FastAPI': [
      { type: 'dependency', patterns: ['fastapi', 'uvicorn'] },
      { type: 'content', patterns: [/from fastapi import/] }
    ],
    'Spring Boot': [
      { type: 'file', patterns: ['pom.xml', 'application.properties'] },
      { type: 'content', patterns: [/spring-boot/] }
    ],
    'Ruby on Rails': [
      { type: 'file', patterns: ['Gemfile', 'config/routes.rb'] },
      { type: 'dependency', patterns: ['rails'] }
    ],
    
    // Mobile
    'React Native': [
      { type: 'dependency', patterns: ['react-native', '@react-native'] },
      { type: 'file', patterns: ['metro.config.js', 'android/', 'ios/'] }
    ],
    'Flutter': [
      { type: 'file', patterns: ['pubspec.yaml', 'lib/main.dart'] },
      { type: 'content', patterns: [/import 'package:flutter/] }
    ],
    'Ionic': [
      { type: 'dependency', patterns: ['@ionic/', 'ionic'] }
    ],
    
    // Database & Storage
    'MongoDB': [
      { type: 'dependency', patterns: ['mongodb', 'mongoose'] },
      { type: 'content', patterns: [/mongodb:\/\//, /mongoose\./] }
    ],
    'PostgreSQL': [
      { type: 'dependency', patterns: ['pg', 'postgresql', 'psycopg2'] },
      { type: 'content', patterns: [/postgresql:\/\//, /postgres:\/\//] }
    ],
    'MySQL': [
      { type: 'dependency', patterns: ['mysql', 'mysql2', 'PyMySQL'] },
      { type: 'content', patterns: [/mysql:\/\//] }
    ],
    'Redis': [
      { type: 'dependency', patterns: ['redis', 'ioredis'] },
      { type: 'content', patterns: [/redis:\/\//] }
    ],
    'Firebase': [
      { type: 'dependency', patterns: ['firebase', '@firebase/'] },
      { type: 'file', patterns: ['firebase.json', 'firestore.rules'] }
    ],
    'Supabase': [
      { type: 'dependency', patterns: ['@supabase/'] }
    ],
    
    // Cloud & DevOps
    'Docker': [
      { type: 'file', patterns: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'] }
    ],
    'Kubernetes': [
      { type: 'file', patterns: [/\.yaml$/, /k8s/, /deployment\./, /service\./] },
      { type: 'content', patterns: [/apiVersion:/, /kind: Deployment/] }
    ],
    'AWS': [
      { type: 'dependency', patterns: ['aws-sdk', 'boto3', '@aws-sdk/'] },
      { type: 'file', patterns: ['serverless.yml', 'template.yaml'] }
    ],
    'Google Cloud': [
      { type: 'dependency', patterns: ['@google-cloud/', 'google-cloud'] }
    ],
    'Azure': [
      { type: 'dependency', patterns: ['azure-', '@azure/'] }
    ],
    
    // ML/Data Science
    'TensorFlow': [
      { type: 'dependency', patterns: ['tensorflow', '@tensorflow/'] },
      { type: 'content', patterns: [/import tensorflow/, /from tensorflow/] }
    ],
    'PyTorch': [
      { type: 'dependency', patterns: ['torch', 'pytorch'] },
      { type: 'content', patterns: [/import torch/, /from torch/] }
    ],
    'Scikit-Learn': [
      { type: 'dependency', patterns: ['scikit-learn', 'sklearn'] },
      { type: 'content', patterns: [/from sklearn/, /import sklearn/] }
    ],
    'Pandas': [
      { type: 'dependency', patterns: ['pandas'] },
      { type: 'content', patterns: [/import pandas/, /pd\./] }
    ],
    'NumPy': [
      { type: 'dependency', patterns: ['numpy'] },
      { type: 'content', patterns: [/import numpy/, /np\./] }
    ],
    'Jupyter': [
      { type: 'file', patterns: [/\.ipynb$/] },
      { type: 'dependency', patterns: ['jupyter', 'notebook'] }
    ],
    'Streamlit': [
      { type: 'dependency', patterns: ['streamlit'] },
      { type: 'content', patterns: [/import streamlit/, /st\./] }
    ],
    
    // Testing
    'Jest': [
      { type: 'dependency', patterns: ['jest', '@types/jest'] },
      { type: 'file', patterns: [/\.test\./, /\.spec\./] }
    ],
    'Pytest': [
      { type: 'dependency', patterns: ['pytest'] },
      { type: 'file', patterns: [/test_.*\.py/, /conftest\.py/] }
    ],
    'Cypress': [
      { type: 'dependency', patterns: ['cypress'] },
      { type: 'file', patterns: ['cypress.config.js'] }
    ],
    'Selenium': [
      { type: 'dependency', patterns: ['selenium'] }
    ],
    
    // Build Tools
    'Webpack': [
      { type: 'dependency', patterns: ['webpack'] },
      { type: 'file', patterns: ['webpack.config.js'] }
    ],
    'Vite': [
      { type: 'dependency', patterns: ['vite'] },
      { type: 'file', patterns: ['vite.config.js', 'vite.config.ts'] }
    ],
    'Rollup': [
      { type: 'dependency', patterns: ['rollup'] },
      { type: 'file', patterns: ['rollup.config.js'] }
    ],
    'Parcel': [
      { type: 'dependency', patterns: ['parcel'] }
    ],
    
    // CSS Frameworks
    'Tailwind CSS': [
      { type: 'dependency', patterns: ['tailwindcss'] },
      { type: 'file', patterns: ['tailwind.config.js'] }
    ],
    'Bootstrap': [
      { type: 'dependency', patterns: ['bootstrap'] }
    ],
    'Material-UI': [
      { type: 'dependency', patterns: ['@mui/', '@material-ui/'] }
    ],
    'Chakra UI': [
      { type: 'dependency', patterns: ['@chakra-ui/'] }
    ],
    
    // State Management
    'Redux': [
      { type: 'dependency', patterns: ['redux', '@reduxjs/'] }
    ],
    'MobX': [
      { type: 'dependency', patterns: ['mobx'] }
    ],
    'Zustand': [
      { type: 'dependency', patterns: ['zustand'] }
    ],
    'Pinia': [
      { type: 'dependency', patterns: ['pinia'] }
    ]
  };

  // Feature detection patterns
  const featurePatterns = {
    'Authentication': [/auth/i, /login/i, /jwt/i, /oauth/i, /passport/i, /session/i],
    'API Integration': [/api/i, /fetch/i, /axios/i, /request/i, /graphql/i],
    'Database Integration': [/db/i, /database/i, /model/i, /schema/i, /migration/i],
    'Real-time Features': [/socket/i, /websocket/i, /realtime/i, /sse/i],
    'File Upload': [/upload/i, /multer/i, /storage/i, /aws-s3/i],
    'Payment Processing': [/stripe/i, /paypal/i, /payment/i, /billing/i],
    'Email Services': [/mail/i, /email/i, /smtp/i, /nodemailer/i],
    'Caching': [/cache/i, /redis/i, /memcached/i],
    'Testing Suite': [/test/i, /spec/i, /__tests__/i, /cypress/i, /jest/i],
    'CI/CD Pipeline': [/\.github\/workflows/i, /\.travis\.yml/, /\.circleci/i, /jenkins/i],
    'Containerization': [/dockerfile/i, /docker-compose/i, /\.dockerignore/i],
    'Monitoring': [/monitor/i, /analytics/i, /logging/i, /sentry/i],
    'Progressive Web App': [/pwa/i, /manifest\.json/i, /service-worker/i, /sw\.js/i],
    'Mobile Responsive': [/responsive/i, /mobile/i, /breakpoint/i, /@media/i],
    'SEO Optimization': [/seo/i, /meta/i, /sitemap/i, /robots\.txt/i],
    'Internationalization': [/i18n/i, /locale/i, /translation/i, /intl/i],
    'Dark Mode': [/dark.*mode/i, /theme/i, /color.*scheme/i],
    'Data Visualization': [/chart/i, /graph/i, /d3/i, /plotly/i, /recharts/i],
    'Machine Learning': [/ml/i, /model/i, /predict/i, /train/i, /tensorflow/i, /pytorch/i],
    'Data Processing': [/etl/i, /pipeline/i, /processor/i, /pandas/i, /numpy/i],
    'Microservices': [/microservice/i, /gateway/i, /consul/i],
    'GraphQL': [/graphql/i, /apollo/i, /relay/i],
    'WebSocket': [/websocket/i, /ws/i, /socket\.io/i],
    'Background Jobs': [/job/i, /queue/i, /worker/i, /celery/i, /bull/i],
    'Search Functionality': [/search/i, /elastic/i, /solr/i, /algolia/i],
    'Content Management': [/cms/i, /admin/i, /dashboard/i, /strapi/i]
  };

  // Count files by extension and detect languages
  files.forEach(file => {
    if (!file || !file.name) return;
    
    const ext = file.name.split('.').pop()?.toLowerCase();
    const name = file.name.toLowerCase();
    const path = file.path?.toLowerCase() || '';
    
    // Count file types
    if (ext) {
      analysis.filesByType.set(ext, (analysis.filesByType.get(ext) || 0) + 1);
      
      // Add language based on extension
      if (languageMap[ext]) {
        const language = languageMap[ext];
        analysis.languages.set(language, (analysis.languages.get(language) || 0) + 1);
      }
    }
    
    // Check for specific file patterns for technologies
    Object.entries(techPatterns).forEach(([tech, patternGroups]) => {
      patternGroups.forEach(group => {
        if (group.type === 'file') {
          group.patterns.forEach(pattern => {
            if (typeof pattern === 'string') {
              if (name === pattern.toLowerCase() || path.includes(pattern.toLowerCase())) {
                analysis.technologies.add(tech);
              }
            } else if (pattern instanceof RegExp) {
              if (pattern.test(name) || pattern.test(path)) {
                analysis.technologies.add(tech);
              }
            }
          });
        }
      });
    });
    
    // Check features based on file names and paths
    Object.entries(featurePatterns).forEach(([feature, patterns]) => {
      patterns.forEach(pattern => {
        if (pattern instanceof RegExp) {
          if (pattern.test(name) || pattern.test(path)) {
            analysis.features.add(feature);
          }
        }
      });
    });
  });

  // Add repository primary language if available
  if (repoData.language) {
    analysis.languages.set(repoData.language, (analysis.languages.get(repoData.language) || 0) + 100); // Give primary language more weight
  }

  // Analyze configuration files content
  const configFiles = ['package.json', 'requirements.txt', 'setup.py', 'pom.xml', 'Cargo.toml', 'composer.json'];
  for (const file of files) {
    if (configFiles.includes(file.name) && file.download_url) {
      try {
        const response = await fetch(file.download_url);
        if (response.ok) {
          const content = await response.text();
          await analyzeConfigContent(file.name, content, analysis, techPatterns);
        }
      } catch (error) {
        console.log(`Could not fetch ${file.name}:`, error.message);
      }
    }
  }

  // Convert languages Map to sorted array
  const sortedLanguages = Array.from(analysis.languages.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .map(([lang, count]) => lang)
    .slice(0, 5); // Top 5 languages

  // Determine project type
  const projectType = determineProjectType(analysis);

  return {
    languages: sortedLanguages,
    primaryLanguage: sortedLanguages[0] || repoData.language || 'Unknown',
    technologies: Array.from(analysis.technologies).slice(0, 8),
    features: Array.from(analysis.features).slice(0, 12),
    projectType: projectType,
    totalFiles: analysis.totalFiles,
    filesByType: Object.fromEntries(Array.from(analysis.filesByType.entries()).slice(0, 10)),
    hasTests: analysis.features.has('Testing Suite'),
    hasDocker: analysis.technologies.has('Docker'),
    hasCICD: analysis.features.has('CI/CD Pipeline'),
    repositoryStats: {
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      issues: repoData.open_issues_count || 0,
      size: repoData.size || 0
    }
  };
}

async function analyzeConfigContent(filename, content, analysis, techPatterns) {
  if (filename === 'package.json') {
    try {
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      
      // Check technologies based on dependencies
      Object.entries(techPatterns).forEach(([tech, patternGroups]) => {
        patternGroups.forEach(group => {
          if (group.type === 'dependency') {
            group.patterns.forEach(pattern => {
              Object.keys(allDeps).forEach(dep => {
                if (dep.includes(pattern) || dep.startsWith(pattern)) {
                  analysis.technologies.add(tech);
                }
              });
            });
          }
        });
      });
      
      // Feature detection based on dependencies
      Object.keys(allDeps).forEach(dep => {
        if (dep.includes('auth') || dep.includes('jwt') || dep.includes('passport')) {
          analysis.features.add('Authentication');
        }
        if (dep.includes('socket')) analysis.features.add('Real-time Features');
        if (dep.includes('multer') || dep.includes('upload')) analysis.features.add('File Upload');
        if (dep.includes('stripe') || dep.includes('paypal')) analysis.features.add('Payment Processing');
        if (dep.includes('test') || dep.includes('jest') || dep.includes('cypress')) analysis.features.add('Testing Suite');
        if (dep.includes('graphql')) analysis.features.add('GraphQL');
      });
      
      // Check scripts for additional insights
      if (pkg.scripts) {
        Object.values(pkg.scripts).forEach(script => {
          if (typeof script === 'string') {
            if (script.includes('test')) analysis.features.add('Testing Suite');
            if (script.includes('docker')) analysis.features.add('Containerization');
            if (script.includes('build')) analysis.features.add('Build Pipeline');
            if (script.includes('deploy')) analysis.features.add('CI/CD Pipeline');
          }
        });
      }
    } catch (error) {
      console.log('Error parsing package.json:', error.message);
    }
  }
  
  if (filename === 'requirements.txt') {
    const lines = content.split('\n');
    lines.forEach(line => {
      const dep = line.toLowerCase().trim().split(/[>=<]/)[0];
      
      // Check technologies based on Python dependencies
      Object.entries(techPatterns).forEach(([tech, patternGroups]) => {
        patternGroups.forEach(group => {
          if (group.type === 'dependency') {
            group.patterns.forEach(pattern => {
              if (dep.includes(pattern)) {
                analysis.technologies.add(tech);
              }
            });
          }
        });
      });
      
      // Feature detection
      if (dep.includes('django') || dep.includes('flask') || dep.includes('fastapi')) {
        analysis.features.add('API Integration');
      }
      if (dep.includes('tensorflow') || dep.includes('torch') || dep.includes('sklearn')) {
        analysis.features.add('Machine Learning');
      }
      if (dep.includes('pandas') || dep.includes('numpy')) {
        analysis.features.add('Data Processing');
      }
    });
  }
  
  if (filename === 'composer.json') {
    try {
      const composer = JSON.parse(content);
      const deps = { ...composer.require, ...composer['require-dev'] };
      
      Object.keys(deps).forEach(dep => {
        if (dep.includes('laravel')) analysis.technologies.add('Laravel');
        if (dep.includes('symfony')) analysis.technologies.add('Symfony');
        if (dep.includes('doctrine')) analysis.technologies.add('Doctrine');
      });
    } catch (error) {
      console.log('Error parsing composer.json:', error.message);
    }
  }
}

function determineProjectType(analysis) {
  const techs = Array.from(analysis.technologies);
  const features = Array.from(analysis.features);
  const languages = Array.from(analysis.languages.keys());
  
  // ML/AI Projects
  if (techs.some(t => ['TensorFlow', 'PyTorch', 'Scikit-Learn', 'Jupyter'].includes(t)) || 
      features.includes('Machine Learning')) {
    return 'Machine Learning Project';
  }
  
  // Data Science Projects
  if (techs.some(t => ['Pandas', 'NumPy', 'Jupyter'].includes(t)) ||
      features.includes('Data Processing')) {
    return 'Data Science Project';
  }
  
  // Mobile Applications
  if (techs.some(t => ['React Native', 'Flutter', 'Ionic'].includes(t))) {
    return 'Mobile Application';
  }
  
  // Full-Stack Applications
  if (techs.some(t => ['Next.js', 'Nuxt.js'].includes(t))) {
    return 'Full-Stack Application';
  }
  
  // Frontend Applications
  if (techs.some(t => ['React', 'Vue.js', 'Angular', 'Svelte'].includes(t))) {
    return 'Frontend Application';
  }
  
  // Backend APIs
  if (techs.some(t => ['Express.js', 'Django', 'Flask', 'FastAPI', 'Spring Boot'].includes(t))) {
    return 'Backend API';
  }
  
  // Microservices
  if (techs.includes('Docker') && features.includes('Microservices')) {
    return 'Microservices Architecture';
  }
  
  // Language-based classification
  if (languages.includes('Python')) return 'Python Application';
  if (languages.includes('JavaScript') || languages.includes('TypeScript')) return 'JavaScript Application';
  if (languages.includes('Java')) return 'Java Application';
  if (languages.includes('Go')) return 'Go Application';
  if (languages.includes('Rust')) return 'Rust Application';
  
  return 'Software Project';
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

const fetchRepoFiles = async (owner, repo, path = "", depth = 0) => {
  if (depth > 3) return []; // Increased depth slightly
  
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  
  try {
    const items = await makeRequest(url);
    if (!Array.isArray(items)) return [];
    
    let files = [];
    for (const item of items.slice(0, 100)) { // Increased file limit
      if (item.type === "file" && item.size < 1024 * 1024) { // Skip files larger than 1MB
        files.push({
          name: item.name,
          path: item.path,
          size: item.size || 0,
          download_url: item.download_url
        });
      } else if (item.type === "dir" && depth < 2 && !item.name.startsWith('.') && 
                !['node_modules', 'vendor', 'dist', 'build', '__pycache__'].includes(item.name)) {
        const subFiles = await fetchRepoFiles(owner, repo, item.path, depth + 1);
        files = files.concat(subFiles);
      }
    }
    return files;
  } catch (error) {
    console.error(`Error fetching files from ${path}:`, error.message);
    if (depth === 0) throw error;
    return [];
  }
};

const generateReadme = async (repoInfo, files, repoData) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured');
  }

  const analysis = await analyzeRepository(files, repoData);
  
  const prompt = `Generate a comprehensive README.md for this GitHub repository:

**Repository:** ${repoData.full_name}
**Description:** ${repoData.description || 'No description provided'}
**Primary Language:** ${analysis.primaryLanguage}
**Languages:** ${analysis.languages.join(', ')}
**Technologies:** ${analysis.technologies.join(', ')}
**Features:** ${analysis.features.join(', ')}
**Project Type:** ${analysis.projectType}
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

app.post("/generate-readme", async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: "Repository URL is required" });
    }

    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) {
      return res.status(400).json({ error: "Invalid GitHub URL format" });
    }

    // Get repo data and files
    const [repoData, files] = await Promise.all([
      makeRequest(`${GITHUB_API}/repos/${repoInfo.owner}/${repoInfo.repo}`),
      fetchRepoFiles(repoInfo.owner, repoInfo.repo)
    ]);

    if (files.length === 0) {
      throw new Error("No accessible files found in repository");
    }

    // Generate README and analysis
    const [readme, analysis] = await Promise.all([
      generateReadme(repoInfo, files, repoData),
      analyzeRepository(files, repoData)
    ]);

    res.json({
      readme,
      analysis: {
        ...analysis,
        summary: {
          totalFiles: analysis.totalFiles,
          primaryLanguage: analysis.primaryLanguage,
          topTechnologies: analysis.technologies.slice(0, 5),
          keyFeatures: analysis.features.slice(0, 8),
          projectComplexity: analysis.technologies.length > 5 ? 'Complex' : 
                            analysis.technologies.length > 2 ? 'Moderate' : 'Simple'
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
      'POST /generate-readme'
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