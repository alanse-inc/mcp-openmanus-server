#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// 現在のファイルの相対パスを取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// 環境変数マッピング定義
const ENV_MAPPINGS = {
  // LLM基本設定
  OPENMANUS_LLM_MODEL: 'llm.model',
  OPENMANUS_LLM_BASE_URL: 'llm.base_url',
  OPENAI_API_KEY: 'llm.api_key', // 互換性のために両方サポート
  OPENMANUS_LLM_API_KEY: 'llm.api_key',
  OPENMANUS_LLM_MAX_TOKENS: 'llm.max_tokens',
  OPENMANUS_LLM_TEMPERATURE: 'llm.temperature',
  OPENMANUS_LLM_API_TYPE: 'llm.api_type',
  OPENMANUS_LLM_API_VERSION: 'llm.api_version',

  // Vision モデル設定
  OPENMANUS_VISION_MODEL: 'llm.vision.model',
  OPENMANUS_VISION_BASE_URL: 'llm.vision.base_url',
  OPENMANUS_VISION_API_KEY: 'llm.vision.api_key',
  OPENMANUS_VISION_MAX_TOKENS: 'llm.vision.max_tokens',
  OPENMANUS_VISION_TEMPERATURE: 'llm.vision.temperature',
  OPENMANUS_VISION_API_TYPE: 'llm.vision.api_type',

  // ブラウザ設定
  OPENMANUS_BROWSER_HEADLESS: 'browser.headless',
  OPENMANUS_BROWSER_DISABLE_SECURITY: 'browser.disable_security',
  OPENMANUS_BROWSER_CHROME_PATH: 'browser.chrome_instance_path',
  OPENMANUS_BROWSER_WSS_URL: 'browser.wss_url',
  OPENMANUS_BROWSER_CDP_URL: 'browser.cdp_url',

  // ブラウザプロキシ設定
  OPENMANUS_PROXY_SERVER: 'browser.proxy.server',
  OPENMANUS_PROXY_USERNAME: 'browser.proxy.username',
  OPENMANUS_PROXY_PASSWORD: 'browser.proxy.password',

  // 検索設定
  OPENMANUS_SEARCH_ENGINE: 'search.engine',
  OPENMANUS_SEARCH_FALLBACK: 'search.fallback_engines',
  OPENMANUS_SEARCH_RETRY_DELAY: 'search.retry_delay',
  OPENMANUS_SEARCH_MAX_RETRIES: 'search.max_retries',
  OPENMANUS_SEARCH_LANG: 'search.lang',
  OPENMANUS_SEARCH_COUNTRY: 'search.country',

  // サンドボックス設定
  OPENMANUS_SANDBOX_USE: 'sandbox.use_sandbox',
  OPENMANUS_SANDBOX_IMAGE: 'sandbox.image',
  OPENMANUS_SANDBOX_WORK_DIR: 'sandbox.work_dir',
  OPENMANUS_SANDBOX_MEMORY_LIMIT: 'sandbox.memory_limit',
  OPENMANUS_SANDBOX_CPU_LIMIT: 'sandbox.cpu_limit',
  OPENMANUS_SANDBOX_TIMEOUT: 'sandbox.timeout',
  OPENMANUS_SANDBOX_NETWORK: 'sandbox.network_enabled',

  // MCP設定
  OPENMANUS_MCP_SERVER_REFERENCE: 'mcp.server_reference',
};

// TOMLファイル内の値を更新する関数
const updateTomlValue = (content, path, value) => {
  // パスをセクションとキーに分割
  const [section, key] = path.split('.');

  // 数値型やブール型の場合は引用符なしで設定
  let formattedValue = value;
  if (value === 'true' || value === 'false' || !isNaN(Number(value))) {
    formattedValue = value;
  } else if (value.startsWith('[') && value.endsWith(']')) {
    // 配列の場合はそのまま
    formattedValue = value;
  } else {
    // 文字列の場合は引用符で囲む
    formattedValue = `"${value}"`;
  }

  // 単一セクション更新 (e.g., [llm])
  const sectionRegex = new RegExp(`\\[${section}\\]([^\\[]*)`, 's');
  const sectionMatch = content.match(sectionRegex);

  if (sectionMatch) {
    const sectionContent = sectionMatch[1];
    const keyRegex = new RegExp(`${key}\\s*=\\s*.*`, 'm');

    if (keyRegex.test(sectionContent)) {
      // キーが存在する場合は更新
      return content.replace(sectionRegex, `[${section}]${sectionMatch[1].replace(keyRegex, `${key} = ${formattedValue}`)}`);
    } else {
      // キーが存在しない場合は追加
      return content.replace(sectionRegex, `[${section}]${sectionMatch[1]}\n${key} = ${formattedValue}`);
    }
  } else {
    // セクションが存在しない場合はネストしたセクションかどうかを確認
    const nestedSectionRegex = new RegExp(`\\[${section}\\.([^\\]]*)\\]([^\\[]*)`, 'g');
    let nestedMatch;
    let updatedContent = content;
    let foundMatch = false;

    while ((nestedMatch = nestedSectionRegex.exec(content)) !== null) {
      if (nestedMatch[1] === key) {
        foundMatch = true;
        // ネストしたセクションとして既に存在する場合（例: [llm.vision]）
        // この場合は修正が必要ないので何もしない
        break;
      }
    }

    if (!foundMatch) {
      // セクションが完全に存在しない場合は新規作成
      updatedContent = `${content}\n[${section}]\n${key} = ${formattedValue}\n`;
    }

    return updatedContent;
  }
};

// 環境変数からAPI Keyと設定を取得して適用
const updateConfigIfNeeded = () => {
  try {
    const configDir = path.join(rootDir, 'config');
    const configPath = path.join(configDir, 'config.toml');
    const configExamplePath = path.join(configDir, 'config.example.toml');

    // config.toml が存在しない場合、config.example.toml をコピーする
    if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
      fs.mkdirSync(configDir, { recursive: true });
      fs.copyFileSync(configExamplePath, configPath);
    }

    // config.toml が存在する場合、環境変数から設定を適用
    if (fs.existsSync(configPath)) {
      let configContent = fs.readFileSync(configPath, 'utf8');

      // 各環境変数をチェックして設定を更新
      for (const [envVar, configPath] of Object.entries(ENV_MAPPINGS)) {
        if (process.env[envVar]) {
          console.log(`環境変数 ${envVar} を設定: ${configPath}`);
          configContent = updateTomlValue(configContent, configPath, process.env[envVar]);
        }
      }

      // 更新したconfigを保存
      fs.writeFileSync(configPath, configContent);
    }
  } catch (err) {
    console.error('設定ファイルの更新中にエラーが発生しました:', err);
  }
};

// 設定ファイルを更新
updateConfigIfNeeded();

// run_mcp_server.pyを実行
console.log('Starting OpenManus MCP Server...');
const pythonProcess = spawn('python', ['run_mcp_server.py'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env }, // 環境変数を渡す
});

pythonProcess.on('close', (code) => {
  console.log(`OpenManus MCP Server exited with code ${code}`);
});

// Ctrl+C で終了した場合のハンドリング
process.on('SIGINT', () => {
  pythonProcess.kill('SIGINT');
  process.exit(0);
});
