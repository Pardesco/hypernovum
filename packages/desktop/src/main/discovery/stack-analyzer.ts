import * as fs from 'fs';
import * as path from 'path';

/**
 * Analyze a project directory to detect the tech stack.
 * Reads config files (package.json, Cargo.toml, etc.) and extracts
 * known frameworks, libraries, and languages.
 */
export function analyzeStack(projectDir: string): string[] {
  const stack: Set<string> = new Set();

  // TypeScript detection
  if (fileExists(projectDir, 'tsconfig.json')) {
    stack.add('TypeScript');
  }

  // Dockerfile
  if (fileExists(projectDir, 'Dockerfile') || fileExists(projectDir, 'docker-compose.yml') || fileExists(projectDir, 'docker-compose.yaml')) {
    stack.add('Docker');
  }

  // JavaScript/TypeScript ecosystem (package.json)
  analyzePackageJson(projectDir, stack);

  // Rust (Cargo.toml)
  analyzeCargoToml(projectDir, stack);

  // Python (pyproject.toml, setup.py)
  analyzePython(projectDir, stack);

  // Go (go.mod)
  analyzeGoMod(projectDir, stack);

  // Java/Kotlin (pom.xml, build.gradle)
  analyzeJvm(projectDir, stack);

  return Array.from(stack);
}

function fileExists(dir: string, name: string): boolean {
  try {
    return fs.statSync(path.join(dir, name)).isFile();
  } catch {
    return false;
  }
}

function readFileString(dir: string, name: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, name), 'utf8');
  } catch {
    return null;
  }
}

/** Known npm dependency → stack label mappings */
const NPM_STACK_MAP: Record<string, string> = {
  // Frameworks
  'react': 'React',
  'react-dom': 'React',
  'next': 'Next.js',
  'vue': 'Vue',
  'nuxt': 'Nuxt',
  'svelte': 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  'angular': 'Angular',
  '@angular/core': 'Angular',
  'solid-js': 'Solid',
  'astro': 'Astro',

  // Backend
  'express': 'Express',
  'fastify': 'Fastify',
  'hono': 'Hono',
  'koa': 'Koa',
  'nestjs': 'NestJS',
  '@nestjs/core': 'NestJS',

  // 3D / Visualization
  'three': 'Three.js',
  '@react-three/fiber': 'R3F',
  'd3': 'D3',
  'chart.js': 'Chart.js',
  'recharts': 'Recharts',
  'plotly.js': 'Plotly',

  // Desktop
  'electron': 'Electron',
  'tauri': 'Tauri',

  // Build tools
  'vite': 'Vite',
  'webpack': 'Webpack',
  'esbuild': 'esbuild',
  'rollup': 'Rollup',
  'turbopack': 'Turbopack',

  // State management
  'zustand': 'Zustand',
  'redux': 'Redux',
  '@reduxjs/toolkit': 'Redux Toolkit',
  'mobx': 'MobX',
  'jotai': 'Jotai',

  // CSS
  'tailwindcss': 'Tailwind',
  'styled-components': 'Styled Components',
  '@emotion/react': 'Emotion',

  // Databases
  'prisma': 'Prisma',
  '@prisma/client': 'Prisma',
  'drizzle-orm': 'Drizzle',
  'mongoose': 'Mongoose',
  'pg': 'PostgreSQL',
  'better-sqlite3': 'SQLite',

  // Testing
  'jest': 'Jest',
  'vitest': 'Vitest',
  'playwright': 'Playwright',
  'cypress': 'Cypress',

  // Obsidian
  'obsidian': 'Obsidian',
};

function analyzePackageJson(dir: string, stack: Set<string>): void {
  const content = readFileString(dir, 'package.json');
  if (!content) return;

  try {
    const pkg = JSON.parse(content);
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // Add JavaScript if no TypeScript detected
    if (!stack.has('TypeScript')) {
      stack.add('JavaScript');
    }

    for (const depName of Object.keys(allDeps)) {
      const label = NPM_STACK_MAP[depName];
      if (label) {
        stack.add(label);
      }
    }

    // Detect if this is an Obsidian plugin (refine category)
    if (allDeps['obsidian'] || fileExists(dir, 'manifest.json')) {
      stack.add('Obsidian');
    }
  } catch {
    // Invalid JSON — skip
  }
}

/** Known Rust crate → stack label mappings */
const RUST_CRATE_MAP: Record<string, string> = {
  'tokio': 'Tokio',
  'actix-web': 'Actix',
  'axum': 'Axum',
  'serde': 'Serde',
  'sqlx': 'SQLx',
  'diesel': 'Diesel',
  'warp': 'Warp',
  'rocket': 'Rocket',
  'tauri': 'Tauri',
  'bevy': 'Bevy',
  'wasm-bindgen': 'WASM',
};

function analyzeCargoToml(dir: string, stack: Set<string>): void {
  const content = readFileString(dir, 'Cargo.toml');
  if (!content) return;

  stack.add('Rust');

  // Simple TOML parsing — look for known crate names in [dependencies]
  for (const [crate, label] of Object.entries(RUST_CRATE_MAP)) {
    // Match lines like: `tokio = "1.0"` or `tokio = { version = "1.0" }`
    const pattern = new RegExp(`^${crate.replace('-', '[-_]')}\\s*=`, 'm');
    if (pattern.test(content)) {
      stack.add(label);
    }
  }
}

/** Known Python package → stack label mappings */
const PYTHON_PKG_MAP: Record<string, string> = {
  'django': 'Django',
  'flask': 'Flask',
  'fastapi': 'FastAPI',
  'pytorch': 'PyTorch',
  'torch': 'PyTorch',
  'tensorflow': 'TensorFlow',
  'numpy': 'NumPy',
  'pandas': 'Pandas',
  'scikit-learn': 'scikit-learn',
  'matplotlib': 'Matplotlib',
  'plotly': 'Plotly',
  'streamlit': 'Streamlit',
  'celery': 'Celery',
  'sqlalchemy': 'SQLAlchemy',
  'pydantic': 'Pydantic',
};

function analyzePython(dir: string, stack: Set<string>): void {
  const pyproject = readFileString(dir, 'pyproject.toml');
  const setupPy = readFileString(dir, 'setup.py');
  const requirements = readFileString(dir, 'requirements.txt');

  if (!pyproject && !setupPy && !requirements) return;

  stack.add('Python');

  const allContent = [pyproject, setupPy, requirements].filter(Boolean).join('\n');

  for (const [pkg, label] of Object.entries(PYTHON_PKG_MAP)) {
    if (allContent.includes(pkg)) {
      stack.add(label);
    }
  }
}

function analyzeGoMod(dir: string, stack: Set<string>): void {
  const content = readFileString(dir, 'go.mod');
  if (!content) return;

  stack.add('Go');

  // Detect common Go frameworks/libraries
  const goPackages: Record<string, string> = {
    'github.com/gin-gonic/gin': 'Gin',
    'github.com/gofiber/fiber': 'Fiber',
    'github.com/labstack/echo': 'Echo',
    'google.golang.org/grpc': 'gRPC',
    'gorm.io/gorm': 'GORM',
    'github.com/gorilla/mux': 'Gorilla Mux',
  };

  for (const [pkg, label] of Object.entries(goPackages)) {
    if (content.includes(pkg)) {
      stack.add(label);
    }
  }
}

function analyzeJvm(dir: string, stack: Set<string>): void {
  const pom = readFileString(dir, 'pom.xml');
  const gradle = readFileString(dir, 'build.gradle');
  const gradleKts = readFileString(dir, 'build.gradle.kts');

  if (!pom && !gradle && !gradleKts) return;

  // Detect language
  if (gradleKts || (gradle && gradle.includes('kotlin'))) {
    stack.add('Kotlin');
  } else {
    stack.add('Java');
  }

  const allContent = [pom, gradle, gradleKts].filter(Boolean).join('\n');

  if (allContent.includes('spring')) stack.add('Spring');
  if (allContent.includes('quarkus')) stack.add('Quarkus');
  if (allContent.includes('micronaut')) stack.add('Micronaut');
  if (allContent.includes('android')) stack.add('Android');
}
