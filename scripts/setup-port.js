#!/usr/bin/env node
/**
 * Auto-detect available port and update configs before Tauri starts
 * This prevents port conflicts when running multiple Tauri apps
 */
import { detect } from 'detect-port';
import { writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_PORT = 1421;  // Different base port from other Tauri apps

async function setupPort() {
  const port = await detect(BASE_PORT);

  // Update tauri.conf.json
  const tauriConfPath = join(__dirname, '../src-tauri/tauri.conf.json');
  const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));
  const oldPort = tauriConf.build.devUrl.match(/:(\d+)/)?.[1];

  if (oldPort !== String(port)) {
    tauriConf.build.devUrl = `http://localhost:${port}`;
    writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
  }

  // Write port to env file for vite
  const envContent = `VITE_DEV_PORT=${port}\n`;
  writeFileSync(join(__dirname, '../.env.development.local'), envContent);

  if (port !== BASE_PORT) {
    console.log(`\x1b[33m[Auto-Port]\x1b[0m Port ${BASE_PORT} occupied, using \x1b[32m${port}\x1b[0m`);
  } else {
    console.log(`\x1b[32m[Auto-Port]\x1b[0m Using port ${port}`);
  }

  return port;
}

setupPort();
