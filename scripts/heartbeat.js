#!/usr/bin/env node
/**
 * Hypernovum Heartbeat Script
 *
 * Called by Claude Code hooks to signal activity to Hypernovum.
 * Writes status to .hypernovum-status.json in the specified vault.
 *
 * Usage:
 *   node heartbeat.js --vault="/path/to/vault" --project="project-name" --action="editing file.ts"
 *   node heartbeat.js --vault="/path/to/vault" --stop
 *
 * Claude Code Hook Configuration (~/.claude/settings.json):
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "matcher": { "tool_name": ".*" },
 *       "hooks": [{
 *         "type": "command",
 *         "command": "node /path/to/heartbeat.js --vault=\"$VAULT_PATH\" --project=\"$PROJECT\" --action=\"$TOOL_NAME\""
 *       }]
 *     }]
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const params = {};

for (const arg of args) {
  if (arg.startsWith('--')) {
    const [key, ...valueParts] = arg.slice(2).split('=');
    params[key] = valueParts.join('=') || true;
  }
}

// Get vault path from args or environment
const vaultPath = params.vault || process.env.HYPERNOVUM_PATH || process.env.OBSIDIAN_VAULT;

if (!vaultPath) {
  console.error('Error: No vault path specified. Use --vault="/path/to/vault" or set HYPERNOVUM_PATH environment variable.');
  process.exit(1);
}

const statusFile = path.join(vaultPath, '.hypernovum-status.json');

// Handle stop command
if (params.stop) {
  const status = {
    active: false,
    project: null,
    action: null,
    lastPing: Date.now(),
    stoppedAt: Date.now()
  };

  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  console.log('Hypernovum: Activity stopped');
  process.exit(0);
}

// Write active status
const status = {
  active: true,
  project: params.project || 'unknown',
  action: params.action || 'working',
  tool: params.tool || null,
  file: params.file || null,
  lastPing: Date.now()
};

try {
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  // Silent success for hook usage - uncomment for debugging:
  // console.log(`Hypernovum: Ping sent for ${status.project}`);
} catch (err) {
  console.error('Hypernovum heartbeat error:', err.message);
  process.exit(1);
}
