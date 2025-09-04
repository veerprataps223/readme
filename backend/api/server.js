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
    languages: new Set(),
    technologies: new Set(),
    features: new Set(),
    projectType: 'Unknown',
    frameworks: new Set(),
    totalFiles: files.length
  };

  // Language detection with extension mapping
  const languageMap = {
    'js': 'JavaScript', 'jsx': 'JavaScript', 'ts': 'TypeScript', 'tsx': 'TypeScript',
    'py': 'Python', 'java': 'Java', 'cpp': 'C++', 'c': 'C', 'cs': 'C#',
    'rb': 'Ruby', 'php': 'PHP', 'go': 'Go', 'rs': 'Rust', 'swift': 'Swift',
    'kt': 'Kotlin', 'scala': 'Scala', 'r': 'R', 'jl': 'Julia', 'sh': 'Shell',
    'vue': 'Vue.js', 'svelte': 'Svelte', 'dart': 'Dart', 'html': 'HTML',
    'css': 'CSS', 'scss': 'SCSS', 'less': 'LESS', 'sql': 'SQL'
  };

  // Technology detection patterns
  const techPatterns = {
    // Frontend Frameworks
    'React': ['package.json', /react/i, 'jsx', 'tsx', /component/i],
    'Vue.js': ['package.json', /vue/i, 'vue'],
    'Angular': ['package.json', /angular/i, 'angular.json'],
    'Svelte': ['package.json', /svelte/i, 'svelte'],
    'Next.js': ['package.json', /next/i, 'next.config'],
    'Nuxt.js': ['package.json', /nuxt/i, 'nuxt.config'],
    
    // Backend Frameworks
    'Node.js': ['package.json', 'server.js', 'app.js', 'index.js'],
    'Express.js': ['package.json', /express/i],
    'Django': ['manage.py', 'settings.py', /django/i],
    'Flask': ['app.py', /flask/i],
    'FastAPI': [/fastapi/i, /uvicorn/i],
    'Spring Boot': ['pom.xml', /spring/i],
    'Ruby on Rails': ['Gemfile', /rails/i],
    
    // Mobile
    'React Native': ['package.json', /react-native/i],
    'Flutter': ['pubspec.yaml', /flutter/i],
    'Ionic': ['package.json', /ionic/i],
    
    // Database & Storage
    'MongoDB': [/mongo/i, 'mongoose'],
    'PostgreSQL': [/postgres/i, /pg/i],
    'MySQL': [/mysql/i],
    'Redis': [/redis/i],
    'Firebase': [/firebase/i],
    'Supabase': [/supabase/i],
    
    // Cloud & DevOps
    'Docker': ['Dockerfile', 'docker-compose.yml'],
    'Kubernetes': [/k8s/i, /kubernetes/i, '.yaml'],
    'AWS': [/aws/i, /lambda/i, /s3/i],
    'Google Cloud': [/gcp/i, /google-cloud/i],
    'Azure': [/azure/i],
    
    // ML/Data Science
    'TensorFlow': [/tensorflow/i, /tf/i],
    'PyTorch': [/torch/i, /pytorch/i],
    'Scikit-Learn': [/sklearn/i, /scikit-learn/i],
    'Pandas': [/pandas/i],
    'NumPy': [/numpy/i],
    'Jupyter': ['.ipynb', /jupyter/i],
    'Streamlit': [/streamlit/i],
    
    // Testing
    'Jest': [/jest/i],
    'Pytest': [/pytest/i],
    'Cypress': [/cypress/i],
    'Selenium': [/selenium/i],
    
    // Build Tools
    'Webpack': [/webpack/i],
    'Vite': [/vite/i, 'vite.config'],
    'Rollup': [/rollup/i],
    'Parcel': [/parcel/i],
    
    // CSS Frameworks
    'Tailwind CSS': [/tailwind/i],
    'Bootstrap': [/bootstrap/i],
    'Material-UI': [/mui/i, /material-ui/i],
    'Chakra UI': [/chakra/i],
    
    // State Management
    'Redux': [/redux/i],
    'MobX': [/mobx/i],
    'Zustand': [/zustand/i],
    'Pinia': [/pinia/i],
  };

  // Feature detection patterns
  const featurePatterns = {
    'Authentication': [/auth/i, /login/i, /jwt/i, /oauth/i, /passport/i],
    'API Integration': [/api/i, /fetch/i, /axios/i, /request/i],
    'Database Integration': [/db/i, /database/i, /model/i, /schema/i],
    'Real-time Features': [/socket/i, /websocket/i, /realtime/i],
    'File Upload': [/upload/i, /multer/i, /file/i],
    'Payment Processing': [/stripe/i, /paypal/i, /payment/i],
    'Email Services': [/mail/i, /email/i, /smtp/i],
    'Caching': [/cache/i, /redis/i, /memcached/i],
    'Testing Suite': [/test/i, /spec/i, /__tests__/i],
    'CI/CD Pipeline': [/ci/i, /cd/i, /github\/workflows/i, '.travis.yml'],
    'Containerization': ['Dockerfile', /docker/i],
    'Monitoring': [/monitor/i, /analytics/i, /logging/i],
    'Progressive Web App': [/pwa/i, /manifest/i, /service-worker/i],
    'Mobile Responsive': [/responsive/i, /mobile/i, /breakpoint/i],
    'SEO Optimization': [/seo/i, /meta/i, /sitemap/i],
    'Internationalization': [/i18n/i, /locale/i, /translation/i],
    'Dark Mode': [/dark/i, /theme/i, /mode/i],
    'Data Visualization': [/chart/i, /graph/i, /d3/i, /plotly/i],
    'Machine Learning': [/ml/i, /model/i, /predict/i, /train/i],
    'Data Processing': [/etl/i, /pipeline/i, /processor/i],
    'Microservices': [/microservice/i, /service/i, /gateway/i],
    'GraphQL': [/graphql/i, /apollo/i],
    'WebSocket': [/websocket/i, /ws/i, /socket/i],
    'Background Jobs': [/job/i, /queue/i, /worker/i, /celery/i],
    'Search Functionality': [/search/i, /elastic/i, /solr/i],
    'Content Management': [/cms/i, /admin/i, /dashboard/i]
  };

  // Analyze files
  const fileContents = new Map();
  
  // Get file extensions and names
  files.forEach(file => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const name = file.name.toLowerCase();
    const path = file.path?.toLowerCase() || '';
    
    // Add language
    if (ext && languageMap[ext]) {
      analysis.languages.add(languageMap[ext]);
    }
    
    // Check technologies
    Object.entries(techPatterns).forEach(([tech, patterns]) => {
      if (patterns.some(pattern => {
        if (typeof pattern === 'string') {
          return name === pattern.toLowerCase() || name.includes(pattern.toLowerCase());
        }
        if (pattern instanceof RegExp) {
          return pattern.test(name) || pattern.test(path);
        }
        return false;
      })) {
        analysis.technologies.add(tech);
      }
    });
    
    // Check features
    Object.entries(featurePatterns).forEach(([feature, patterns]) => {
      if (patterns.some(pattern => {
        if (typeof pattern === 'string') {
          return name === pattern.toLowerCase() || name.includes(pattern.toLowerCase()) || path.includes(pattern.toLowerCase());
        }
        if (pattern instanceof RegExp) {
          return pattern.test(name) || pattern.test(path) || pattern.test(file.path || '');
        }
        return false;
      })) {
        analysis.features.add(feature);
      }
    });
  });

  // Analyze configuration files content
  const configFiles = ['package.json', 'requirements.txt', 'setup.py', 'pom.xml', 'Cargo.toml'];
  for (const file of files) {
    if (configFiles.includes(file.name) && file.download_url) {
      try {
        const response = await fetch(file.download_url);
        if (response.ok) {
          const content = await response.text();
          fileContents.set(file.name, content);
          await analyzeConfigContent(file.name, content, analysis);
        }
      } catch (error) {
        console.log(`Could not fetch ${file.name}:`, error.message);
      }
    }
  }

  // Add repo language if available
  if (repoData.language) {
    analysis.languages.add(repoData.language);
  }

  // Determine project type
  analysis.projectType = determineProjectType(analysis);

  return {
    languages: Array.from(analysis.languages).slice(0, 5), // Top 5 languages
    technologies: Array.from(analysis.technologies).slice(0, 7), // Top 7 technologies
    features: Array.from(analysis.features).slice(0, 10), // Top 10 features
    projectType: analysis.projectType,
    totalFiles: analysis.totalFiles,
    hasTests: analysis.features.has('Testing Suite'),
    hasDocker: analysis.technologies.has('Docker'),
    hasCICD: analysis.features.has('CI/CD Pipeline'),
    // Debug info to help troubleshoot
    debug: {
      totalLanguagesFound: analysis.languages.size,
      totalTechFound: analysis.technologies.size,
      totalFeaturesFound: analysis.features.size,
      sampleFiles: files.slice(0, 5).map(f => ({ name: f.name, ext: f.name?.split('.').pop() }))
    }
  };
}

async function analyzeConfigContent(filename, content, analysis) {
  if (filename === 'package.json') {
    try {
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      Object.keys(allDeps).forEach(dep => {
        // React ecosystem
        if (dep.includes('react') && !dep.includes('native')) analysis.technologies.add('React');
        if (dep.includes('react-native')) analysis.technologies.add('React Native');
        if (dep.includes('next')) analysis.technologies.add('Next.js');
        if (dep.includes('vue')) analysis.technologies.add('Vue.js');
        if (dep.includes('nuxt')) analysis.technologies.add('Nuxt.js');
        if (dep.includes('angular')) analysis.technologies.add('Angular');
        if (dep.includes('svelte')) analysis.technologies.add('Svelte');
        
        // Backend
        if (dep.includes('express')) analysis.technologies.add('Express.js');
        if (dep.includes('fastify')) analysis.technologies.add('Fastify');
        if (dep.includes('koa')) analysis.technologies.add('Koa.js');
        
        // Databases
        if (dep.includes('mongoose') || dep.includes('mongodb')) analysis.technologies.add('MongoDB');
        if (dep.includes('pg') || dep.includes('postgres')) analysis.technologies.add('PostgreSQL');
        if (dep.includes('mysql')) analysis.technologies.add('MySQL');
        if (dep.includes('redis')) analysis.technologies.add('Redis');
        
        // CSS Frameworks
        if (dep.includes('tailwind')) analysis.technologies.add('Tailwind CSS');
        if (dep.includes('bootstrap')) analysis.technologies.add('Bootstrap');
        if (dep.includes('@mui') || dep.includes('material-ui')) analysis.technologies.add('Material-UI');
        
        // Testing
        if (dep.includes('jest')) analysis.technologies.add('Jest');
        if (dep.includes('cypress')) analysis.technologies.add('Cypress');
        if (dep.includes('playwright')) analysis.technologies.add('Playwright');
        
        // Build tools
        if (dep.includes('webpack')) analysis.technologies.add('Webpack');
        if (dep.includes('vite')) analysis.technologies.add('Vite');
        
        // Features based on dependencies
        if (dep.includes('auth') || dep.includes('jwt') || dep.includes('passport')) {
          analysis.features.add('Authentication');
        }
        if (dep.includes('socket')) analysis.features.add('Real-time Features');
        if (dep.includes('multer') || dep.includes('upload')) analysis.features.add('File Upload');
        if (dep.includes('stripe') || dep.includes('paypal')) analysis.features.add('Payment Processing');
      });
      
      // Check scripts for additional insights
      if (pkg.scripts) {
        Object.values(pkg.scripts).forEach(script => {
          if (typeof script === 'string') {
            if (script.includes('test')) analysis.features.add('Testing Suite');
            if (script.includes('docker')) analysis.features.add('Containerization');
            if (script.includes('build')) analysis.features.add('Build Pipeline');
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
      if (dep.includes('django')) analysis.technologies.add('Django');
      if (dep.includes('flask')) analysis.technologies.add('Flask');
      if (dep.includes('fastapi')) analysis.technologies.add('FastAPI');
      if (dep.includes('tensorflow')) analysis.technologies.add('TensorFlow');
      if (dep.includes('torch') || dep.includes('pytorch')) analysis.technologies.add('PyTorch');
      if (dep.includes('pandas')) analysis.technologies.add('Pandas');
      if (dep.includes('numpy')) analysis.technologies.add('NumPy');
      if (dep.includes('sklearn') || dep.includes('scikit-learn')) analysis.technologies.add('Scikit-Learn');
      if (dep.includes('streamlit')) analysis.technologies.add('Streamlit');
      if (dep.includes('jupyter')) analysis.features.add('Jupyter Notebooks');
      
      // ML/DS features
      if (dep.includes('tensorflow') || dep.includes('torch') || dep.includes('sklearn')) {
        analysis.features.add('Machine Learning');
      }
      if (dep.includes('pandas') || dep.includes('numpy')) {
        analysis.features.add('Data Processing');
      }
    });
  }
}

function determineProjectType(analysis) {
  const techs = Array.from(analysis.technologies);
  const features = Array.from(analysis.features);
  const languages = Array.from(analysis.languages);
  
  if (techs.some(t => ['TensorFlow', 'PyTorch', 'Scikit-Learn'].includes(t))) {
    return 'Machine Learning Project';
  }
  if (techs.some(t => ['React Native', 'Flutter', 'Ionic'].includes(t))) {
    return 'Mobile Application';
  }
  if (techs.some(t => ['React', 'Vue.js', 'Angular', 'Svelte'].includes(t))) {
    return 'Frontend Application';
  }
  if (techs.some(t => ['Next.js', 'Nuxt.js'].includes(t))) {
    return 'Full-Stack Application';
  }
  if (techs.some(t => ['Express.js', 'Django', 'Flask', 'FastAPI'].includes(t))) {
    return 'Backend API';
  }
  if (techs.includes('Docker') && features.includes('Microservices')) {
    return 'Microservices Architecture';
  }
  if (features.includes('Data Processing') || techs.includes('Pandas')) {
    return 'Data Science Project';
  }
  if (languages.includes('Python')) return 'Python Application';
  if (languages.includes('JavaScript') || languages.includes('TypeScript')) return 'JavaScript Application';
  
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
  if (depth > 2) return [];
  
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  
  try {
    const items = await makeRequest(url);
    if (!Array.isArray(items)) return [];
    
    let files = [];
    for (const item of items.slice(0, 50)) {
      if (item.type === "file") {
        files.push({
          name: item.name,
          path: item.path,
          size: item.size || 0,
          download_url: item.download_url
        });
      } else if (item.type === "dir" && depth < 2) {
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
**Languages:** ${analysis.languages.join(', ')}
**Technologies:** ${analysis.technologies.join(', ')}
**Features:** ${analysis.features.join(', ')}
**Project Type:** ${analysis.projectType}
**Stars:** ${repoData.stargazers_count || 0}

Create a professional README with these sections in order:
1. **Title** (# format, bold and prominent)
2. **Description** (comprehensive overview)
3. **Features** (key functionality and capabilities)
4. **Tech Stack** (technologies and frameworks used)
5. **Installation** (setup instructions)
6. **Usage** (how to use/run the project)
7. **API Documentation** (if applicable)
8. **Contributing** (contribution guidelines)
9. **License** (license information)

Make it engaging, professional, and include relevant badges. Return ONLY markdown content without code blocks.`;

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
      analysis,
      model: "gemini-2.0-flash-exp",
      repository: {
        name: repoData.full_name,
        description: repoData.description,
        stars: repoData.stargazers_count,
        language: repoData.language
      }
    });

  } catch (error) {
    console.error('Generation failed:', error.message);
    const status = error.message.includes('not found') ? 404 : 
                   error.message.includes('Rate limit') ? 429 : 500;
    res.status(status).json({ error: error.message });
  }
});

app.get("/health", async (req, res) => {
  res.json({
    status: "healthy",
    environment: {
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasGithubToken: !!process.env.GITHUB_TOKEN,
      port: PORT
    },
    model: "gemini-2.0-flash-exp"
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Using Gemini 2.0 Flash model`);
  console.log(`🔑 GitHub Token: ${process.env.GITHUB_TOKEN ? '✅' : '❌'}`);
  console.log(`🔑 Gemini Key: ${process.env.GEMINI_API_KEY ? '✅' : '❌'}`);
});

export default app;