#!/usr/bin/env node

// uvx対応OpenManusサーバー起動スクリプト
// uvx @alanse-inc/mcp-openmanus-server または uvx run-uvx.js で実行可能

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// 現在のファイルの相対パスを取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 引数の処理
const args = process.argv.slice(2);
const isLocalMode = args.includes('local');

// サーバー起動
console.log(`OpenManus MCPサーバーを${isLocalMode ? 'ローカル' : '標準'}モードで起動します...`);

// 実行するスクリプトを選択
const scriptPath = isLocalMode ? path.join(rootDir, 'mcplocal.js') : path.join(rootDir, 'run_mcp_server.js');

// スクリプトが存在するか確認
if (!fs.existsSync(scriptPath)) {
  console.error(`エラー: スクリプト ${scriptPath} が見つかりません。`);
  process.exit(1);
}

// サーバープロセスを起動
const serverProcess = spawn('node', [scriptPath, ...args], {
  stdio: 'inherit',
  env: { ...process.env },
});

// プロセスの終了を処理
serverProcess.on('close', (code) => {
  if (code !== 0) {
    console.error(`OpenManus MCPサーバーが異常終了しました (終了コード: ${code})`);
    process.exit(code);
  }
});

// Ctrl+C などのシグナルをサーバープロセスに転送
process.on('SIGINT', () => {
  serverProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  serverProcess.kill('SIGTERM');
});

// 予期しないエラーを処理
serverProcess.on('error', (err) => {
  console.error(`サーバー実行中にエラーが発生しました: ${err.message}`);
  process.exit(1);
});
