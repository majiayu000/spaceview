#!/usr/bin/env node
/**
 * Smart Tauri dev launcher with automatic port detection
 * Avoids port conflicts when running multiple Tauri apps
 */

import detectPort from 'detect-port';
import { spawn } from 'child_process';

const DEFAULT_PORT = 1420;

async function main() {
  // Find available port starting from 1420
  const port = await detectPort(DEFAULT_PORT);

  if (port !== DEFAULT_PORT) {
    console.log(`⚡ Port ${DEFAULT_PORT} busy, using ${port}`);
  } else {
    console.log(`⚡ Using port ${port}`);
  }

  // Set environment variable for Vite
  process.env.VITE_DEV_PORT = port.toString();

  // Build Tauri config override (escaped for shell)
  const configOverride = `{"build":{"devUrl":"http://localhost:${port}"}}`;

  // Start Tauri dev with config override
  const tauri = spawn('pnpm', [
    'tauri', 'dev',
    '--config', `'${configOverride}'`
  ], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_DEV_PORT: port.toString()
    }
  });

  tauri.on('close', (code) => {
    process.exit(code || 0);
  });
}

main().catch(console.error);
