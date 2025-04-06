#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// 現在のファイルの相対パスを取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(__filename);

// サポートされているモデルのリスト
const SUPPORTED_MODELS = {
  openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'],
  anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku', 'claude-3-5-sonnet', 'claude-3-7-sonnet-20250219'],
  azure: [], // Azureはどのデプロイメント名でも許可
  ollama: [], // Ollamaはどのモデル名でも許可
  aws: [], // AWS Bedrockはどのモデル名でも許可
  openrouter: [], // OpenRouterはどのモデル名でも許可
};

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
  OPENMANUS_LLM_OR_SITE_URL: 'llm.openrouter.site_url', // OpenRouter用のサイトURL
  OPENMANUS_LLM_OR_HTTP_REFERER: 'llm.openrouter.http_referer', // OpenRouter用のHTTP Referer

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
  OPENMANUS_BROWSER_TIMEOUT: 'browser.timeout',
  OPENMANUS_BROWSER_RETRY_COUNT: 'browser.retry_count',
  OPENMANUS_BROWSER_RETRY_DELAY: 'browser.retry_delay',
  OPENMANUS_BROWSER_EXTRA_ARGS: 'browser.extra_chromium_args',

  // ブラウザプロキシ設定
  OPENMANUS_PROXY_SERVER: 'browser.proxy.server',
  OPENMANUS_PROXY_USERNAME: 'browser.proxy.username',
  OPENMANUS_PROXY_PASSWORD: 'browser.proxy.password',

  // 検索設定
  OPENMANUS_SEARCH_ENGINE: 'search.engine',
  OPENMANUS_SEARCH_ENGINE_URL: 'search.engine_url',
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

// 逆マッピング（設定パス→環境変数）を作成
const CONFIG_TO_ENV_MAPPINGS = {};
for (const [envVar, configPath] of Object.entries(ENV_MAPPINGS)) {
  CONFIG_TO_ENV_MAPPINGS[configPath] = envVar;
}

// TOMLファイル内の値を更新する関数
const updateTomlValue = (content, path, value) => {
  // パスをセクションとキーに分割
  const pathParts = path.split('.');
  const section = pathParts[0];

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

  // 3階層以上のネストされた設定（例：llm.openrouter.site_url）
  if (pathParts.length > 2) {
    const nestedSection = `${pathParts[0]}.${pathParts[1]}`;
    const key = pathParts[2];

    // ネストセクションの検索
    const nestedSectionRegex = new RegExp(`\\[${nestedSection}\\]([^\\[]*)`, 's');
    const nestedSectionMatch = content.match(nestedSectionRegex);

    if (nestedSectionMatch) {
      // ネストセクションが存在する場合
      const nestedSectionContent = nestedSectionMatch[1];
      const keyRegex = new RegExp(`${key}\\s*=\\s*.*`, 'm');

      if (keyRegex.test(nestedSectionContent)) {
        // キーが存在する場合は更新
        return content.replace(nestedSectionRegex, `[${nestedSection}]${nestedSectionMatch[1].replace(keyRegex, `${key} = ${formattedValue}`)}`);
      } else {
        // キーが存在しない場合は追加
        return content.replace(nestedSectionRegex, `[${nestedSection}]${nestedSectionMatch[1]}\n${key} = ${formattedValue}`);
      }
    } else {
      // ネストセクションが存在しない場合は新規作成
      return `${content}\n[${nestedSection}]\n${key} = ${formattedValue}\n`;
    }
  }

  // 通常の2階層構造（例：llm.model）
  if (pathParts.length === 2) {
    const key = pathParts[1];

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
  }

  // 単一階層の設定（通常はここに来ないはず）
  return content;
};

// TOMLファイルからモデル情報とAPI型を取得
const getModelInfo = (configPath) => {
  try {
    const content = fs.readFileSync(configPath, 'utf8');

    // APIタイプの取得
    const apiTypeMatch = content.match(/api_type\s*=\s*"([^"]+)"/);
    const apiType = apiTypeMatch ? apiTypeMatch[1] : 'openai'; // デフォルトはOpenAI

    // モデル名の取得
    const modelMatch = content.match(/model\s*=\s*"([^"]+)"/);
    const model = modelMatch ? modelMatch[1] : 'gpt-4o'; // デフォルトはGPT-4o

    return { apiType, model };
  } catch (err) {
    console.warn('設定ファイルの読み取り中にエラーが発生しました。デフォルト設定を使用します。');
    return { apiType: 'openai', model: 'gpt-4o' };
  }
};

// モデルの検証
const validateModel = (apiType, model) => {
  // API型が特殊な場合は検証をスキップ
  if (['azure', 'ollama', 'aws', 'openrouter'].includes(apiType.toLowerCase())) {
    console.log(`APIタイプ「${apiType}」では任意のモデル名を使用できます。`);
    return true;
  }

  // AnthropicかOpenAIの場合はモデル名を検証
  const supportedModels = apiType.toLowerCase() === 'anthropic' ? SUPPORTED_MODELS.anthropic : SUPPORTED_MODELS.openai;

  if (!supportedModels.includes(model)) {
    console.warn(`警告: モデル「${model}」はAPIタイプ「${apiType}」で通常サポートされていません。`);
    console.warn(`サポートされているモデル: ${supportedModels.join(', ')}`);
    console.warn('必要に応じて以下の環境変数を設定してください:');
    console.warn(`OPENMANUS_LLM_API_TYPE="適切なAPIタイプ" OPENMANUS_LLM_MODEL="適切なモデル名"`);
    return false;
  }

  return true;
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
      console.log('設定ファイルをconfig.example.tomlからコピーしました');
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

      // モデル情報を取得して検証
      const { apiType, model } = getModelInfo(configPath);
      validateModel(apiType, model);
    }
  } catch (err) {
    console.error('設定ファイルの更新中にエラーが発生しました:', err);
  }
};

// APIキーチェック
const checkApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENMANUS_LLM_API_KEY;
  if (!apiKey) {
    console.warn('警告: API Keyが設定されていません。設定ファイルまたは環境変数で指定してください。');
    console.warn('例: OPENAI_API_KEY="your-api-key" npx @alanse-inc/mcp-openmanus-server');
    return false;
  }

  // APIキーの形式の簡易チェック（OpenAIの場合）
  if (apiKey.startsWith('sk-') && apiKey.length < 40) {
    console.warn('警告: OpenAI APIキーの形式が正しくない可能性があります。有効なAPIキーを確認してください。');
    return false;
  }

  return true;
};

// Python環境のチェック
const checkPythonEnvironment = () => {
  try {
    // run_mcp_server.pyファイルが存在するか確認
    const mcpServerPath = path.join(rootDir, 'run_mcp_server.py');
    if (!fs.existsSync(mcpServerPath)) {
      console.error('エラー: run_mcp_server.pyが見つかりません。');
      console.error(`期待されるパス: ${mcpServerPath}`);
      return false;
    }

    // requirements.txtが存在するか確認
    const requirementsPath = path.join(rootDir, 'requirements.txt');
    if (!fs.existsSync(requirementsPath)) {
      console.warn('警告: requirements.txtが見つかりません。依存関係が不足している可能性があります。');
    }

    return true;
  } catch (err) {
    console.error('Python環境のチェック中にエラーが発生しました:', err);
    return false;
  }
};

// Python依存関係のインストール
const installPythonDependencies = () => {
  return new Promise((resolve, reject) => {
    console.log('Pythonの依存関係をインストール中...');
    const pip = spawn('pip', ['install', '-r', 'requirements.txt'], {
      cwd: rootDir,
      stdio: 'inherit',
    });

    pip.on('close', (code) => {
      if (code === 0) {
        console.log('依存関係のインストールに成功しました。');
        resolve(true);
      } else {
        console.warn(`警告: 依存関係のインストールが完了しませんでした (終了コード: ${code})`);
        console.warn('必要に応じて手動で「pip install -r requirements.txt」を実行してください。');
        resolve(false);
      }
    });

    pip.on('error', (err) => {
      console.warn('警告: Pipコマンドの実行時にエラーが発生しました:', err.message);
      console.warn('Python環境が正しくセットアップされていることを確認してください。');
      resolve(false);
    });
  });
};

// MCPサーバーの起動
const startMCPServer = () => {
  // run_mcp_server.pyを実行
  console.log('OpenManus MCPサーバーを起動中...');

  const pythonPath = process.env.OPENMANUS_PYTHON_PATH || 'python';
  const pythonProcess = spawn(pythonPath, ['run_mcp_server.py'], {
    cwd: rootDir,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'], // IPCを追加
    env: {
      ...process.env,
      // MCP設定機能のパスをエクスポート
      OPENMANUS_MCP_CONFIG_ENABLED: 'true',
    },
  });

  // MCP設定機能インターフェース
  // MCP設定関数をグローバルに公開
  global.openmanusConfig = {
    getConfig: getConfigViaMCP,
    updateConfig: updateConfigViaMCP,
    exportEnvVars: exportEnvironmentVariables,
  };

  pythonProcess.on('close', (code) => {
    if (code === 0) {
      console.log('OpenManus MCPサーバーが正常に終了しました。');
    } else {
      console.error(`エラー: OpenManus MCPサーバーが異常終了しました (終了コード: ${code})`);
      if (code === 127) {
        console.error('Python実行環境が見つかりませんでした。Pythonがインストールされているか確認してください。');
        console.error('特定のPythonパスを使用する場合は、OPENMANUS_PYTHON_PATH環境変数を設定してください。');
      }
    }
  });

  pythonProcess.on('error', (err) => {
    console.error('エラー: Pythonプロセスの起動に失敗しました:', err.message);
    console.error('Python実行環境が正しくセットアップされていることを確認してください。');
    process.exit(1);
  });

  // Ctrl+C で終了した場合のハンドリング
  process.on('SIGINT', () => {
    console.log('プロセスを終了中...');
    pythonProcess.kill('SIGINT');
    process.exit(0);
  });

  // 終了時に子プロセスも確実に終了させる
  process.on('exit', () => {
    pythonProcess.kill();
  });
};

// 検索エンジン設定のチェックと修正
const checkSearchEngineSettings = () => {
  try {
    const configDir = path.join(rootDir, 'config');
    const configPath = path.join(configDir, 'config.toml');

    if (fs.existsSync(configPath)) {
      let configContent = fs.readFileSync(configPath, 'utf8');
      let modified = false;

      // 検索セクションの存在確認
      if (!configContent.includes('[search]')) {
        console.log('検索セクションが見つかりません。デフォルト設定を追加します。');
        configContent += '\n[search]\n';
        configContent += 'engine = "google"\n';
        configContent += 'engine_url = "https://www.google.com"\n';
        configContent += 'lang = "ja"\n';
        configContent += 'country = "jp"\n';
        modified = true;
      } else {
        // 検索エンジンURLの確認
        const engineUrlRegex = /engine_url\s*=\s*"([^"]*)"/;
        const engineUrlMatch = configContent.match(engineUrlRegex);

        if (!engineUrlMatch) {
          console.log('検索エンジンURLが設定されていません。デフォルト設定を追加します。');

          // エンジン名の取得
          const engineRegex = /engine\s*=\s*"([^"]*)"/;
          const engineMatch = configContent.match(engineRegex);
          const engine = engineMatch ? engineMatch[1] : 'google';

          // エンジン名に基づいてデフォルトURLを設定
          let defaultUrl = 'https://www.google.com';
          if (engine === 'bing') {
            defaultUrl = 'https://www.bing.com';
          } else if (engine === 'duckduckgo') {
            defaultUrl = 'https://duckduckgo.com';
          } else if (engine === 'yahoo') {
            defaultUrl = 'https://search.yahoo.com';
          }

          // searchセクションにengine_urlを追加
          configContent = configContent.replace(/\[search\]([^\[]*)/s, `[search]$1engine_url = "${defaultUrl}"\n`);
          modified = true;
        } else {
          const engineUrl = engineUrlMatch[1];
          // URLの形式確認（http:// または https:// で始まっているか）
          if (!engineUrl.startsWith('http://') && !engineUrl.startsWith('https://')) {
            console.warn('警告: 検索エンジンURLの形式が正しくありません。有効なURLを設定してください。');
            console.warn('例: https://www.google.com');
          }
        }
      }

      // 変更があれば設定ファイルを更新
      if (modified) {
        fs.writeFileSync(configPath, configContent);
        console.log('検索エンジン設定を更新しました。');
      }
    }

    return true;
  } catch (err) {
    console.error('検索エンジン設定のチェック中にエラーが発生しました:', err);
    return false;
  }
};

// ブラウザ設定のチェック
const checkBrowserSettings = () => {
  try {
    const configDir = path.join(rootDir, 'config');
    const configPath = path.join(configDir, 'config.toml');

    if (fs.existsSync(configPath)) {
      let configContent = fs.readFileSync(configPath, 'utf8');
      let modified = false;

      // ブラウザセクションの存在確認
      if (!configContent.includes('[browser]')) {
        console.warn('警告: 設定ファイルにブラウザセクションが見つかりません。基本設定を追加します。');
        configContent += '\n[browser]\n';
        configContent += 'headless = false\n';
        configContent += 'disable_security = true\n';
        configContent += 'timeout = 30000\n';
        configContent += 'retry_count = 3\n';
        configContent += 'retry_delay = 1000\n';
        modified = true;
      } else {
        // タイムアウト設定の確認
        if (!configContent.match(/timeout\s*=\s*\d+/)) {
          configContent = configContent.replace(/\[browser\]([^\[]*)/s, `[browser]$1timeout = 30000\n`);
          modified = true;
        }

        // リトライ設定の確認
        if (!configContent.match(/retry_count\s*=\s*\d+/)) {
          configContent = configContent.replace(/\[browser\]([^\[]*)/s, `[browser]$1retry_count = 3\n`);
          modified = true;
        }

        if (!configContent.match(/retry_delay\s*=\s*\d+/)) {
          configContent = configContent.replace(/\[browser\]([^\[]*)/s, `[browser]$1retry_delay = 1000\n`);
          modified = true;
        }
      }

      // プロキシ設定のチェック
      const hasProxyServer = /proxy\.server\s*=/.test(configContent);
      const hasProxyUsername = /proxy\.username\s*=/.test(configContent);
      const hasProxyPassword = /proxy\.password\s*=/.test(configContent);

      if (hasProxyServer && (!hasProxyUsername || !hasProxyPassword)) {
        console.warn('警告: プロキシサーバーが設定されていますが、認証情報（ユーザー名/パスワード）が不完全な可能性があります。');
      }

      // 変更があれば設定ファイルを更新
      if (modified) {
        fs.writeFileSync(configPath, configContent);
        console.log('ブラウザ設定を更新しました。');
      }
    }

    return true;
  } catch (err) {
    console.error('ブラウザ設定のチェック中にエラーが発生しました:', err);
    return false;
  }
};

// 設定ファイルから全ての設定を読み込む関数
const readAllConfig = () => {
  try {
    const configDir = path.join(rootDir, 'config');
    const configPath = path.join(configDir, 'config.toml');

    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      return configContent;
    } else {
      return null;
    }
  } catch (err) {
    console.error('設定ファイルの読み取り中にエラーが発生しました:', err);
    return null;
  }
};

// 設定ファイルから特定のセクションを取得
const getConfigSection = (section) => {
  try {
    const configContent = readAllConfig();
    if (!configContent) return null;

    // 単一セクション (e.g., [llm]) の取得
    const sectionRegex = new RegExp(`\\[${section}\\]([^\\[]*)`, 's');
    const sectionMatch = configContent.match(sectionRegex);

    if (sectionMatch) {
      return sectionMatch[1].trim();
    }

    // ネストされたセクション (e.g., [llm.vision]) の取得
    const nestedSections = {};
    const nestedSectionRegex = new RegExp(`\\[${section}\\.([^\\]]*)\\]([^\\[]*)`, 'g');
    let nestedMatch;

    while ((nestedMatch = nestedSectionRegex.exec(configContent)) !== null) {
      nestedSections[nestedMatch[1]] = nestedMatch[2].trim();
    }

    if (Object.keys(nestedSections).length > 0) {
      return nestedSections;
    }

    return null;
  } catch (err) {
    console.error(`セクション「${section}」の読み取り中にエラーが発生しました:`, err);
    return null;
  }
};

// MCPに公開するための環境変数のエクスポート用関数
const exportEnvironmentVariables = () => {
  const envVars = {};

  for (const [envVar, configPath] of Object.entries(ENV_MAPPINGS)) {
    if (process.env[envVar]) {
      envVars[envVar] = process.env[envVar];
    }
  }

  return envVars;
};

// MCPサーバー用の設定更新関数
const updateConfigViaMCP = (updates) => {
  try {
    const configDir = path.join(rootDir, 'config');
    const configPath = path.join(configDir, 'config.toml');

    if (!fs.existsSync(configPath)) {
      return { success: false, error: '設定ファイルが見つかりません' };
    }

    let configContent = fs.readFileSync(configPath, 'utf8');
    let updatedSettings = [];

    // 各更新を処理
    for (const [path, value] of Object.entries(updates)) {
      const oldContent = configContent;
      configContent = updateTomlValue(configContent, path, value);

      // 変更があったか確認
      if (configContent !== oldContent) {
        updatedSettings.push(path);

        // 対応する環境変数があれば更新
        if (CONFIG_TO_ENV_MAPPINGS[path]) {
          process.env[CONFIG_TO_ENV_MAPPINGS[path]] = value;
        }
      }
    }

    // 設定ファイルを更新
    fs.writeFileSync(configPath, configContent);

    return {
      success: true,
      updated: updatedSettings,
    };
  } catch (err) {
    console.error('MCP経由の設定更新中にエラーが発生しました:', err);
    return {
      success: false,
      error: err.message,
    };
  }
};

// MCP経由で設定情報を取得する関数
const getConfigViaMCP = (section = null) => {
  try {
    if (section) {
      // 特定のセクションを取得
      const sectionData = getConfigSection(section);
      return {
        success: true,
        section: section,
        data: sectionData,
      };
    } else {
      // 全ての設定を取得
      const allConfig = readAllConfig();
      return {
        success: true,
        data: allConfig,
      };
    }
  } catch (err) {
    console.error('MCP経由の設定取得中にエラーが発生しました:', err);
    return {
      success: false,
      error: err.message,
    };
  }
};

// メイン処理
const main = async () => {
  // ロゴ表示
  console.log(`
 _____               ___  ___
|  _  |             |   \\/   |
| | | |_ __  ___ _ _| .  . | __ _ _ __  _   _ ___ ___
| | | | '_ \\/ _ \\ '_ \\ |\\/| |/ _\` | '_ \\| | | / __/ __|
\\ \\_/ / |_) |  __/ | | | |  | | (_| | | | | |_| \\__ \\\\___ \\
 \\___/| .__/\\___|_| |_\\_|  |_/\\__,_|_| |_|\\__,_|___/___/
      | |   MCP Server v${process.env.npm_package_version || '0.1.0'}
      |_|
  `);

  // Python環境のチェック
  const pythonOk = checkPythonEnvironment();
  if (!pythonOk) {
    console.error('OpenManus MCPサーバーの起動に必要なファイルが見つかりません。');
    console.error('このパッケージはOpenManusリポジトリのルートディレクトリで実行する必要があります。');
    process.exit(1);
  }

  // 検索エンジン環境変数の設定（もしまだ設定されていない場合）
  if (!process.env.OPENMANUS_SEARCH_ENGINE_URL) {
    // エンジン名の取得
    const engine = process.env.OPENMANUS_SEARCH_ENGINE || 'google';

    // デフォルトのURLを設定
    let defaultUrl = 'https://www.google.com';
    if (engine === 'bing') {
      defaultUrl = 'https://www.bing.com';
    } else if (engine === 'duckduckgo') {
      defaultUrl = 'https://duckduckgo.com';
    } else if (engine === 'yahoo') {
      defaultUrl = 'https://search.yahoo.com';
    }

    // 環境変数に設定
    process.env.OPENMANUS_SEARCH_ENGINE_URL = defaultUrl;
    console.log(`検索エンジンURL環境変数を設定しました: ${defaultUrl}`);
  }

  // 設定ファイルを更新
  updateConfigIfNeeded();

  // 検索エンジン設定のチェック
  checkSearchEngineSettings();

  // ブラウザ設定のチェック
  checkBrowserSettings();

  // APIキーチェック
  if (!checkApiKey()) {
    console.error('APIキーチェックに失敗しました。MCPサーバーの起動を中止します。');
    process.exit(1);
  }

  // 必要に応じてPython依存関係をインストール
  // 注意: この機能を無効にしたい場合は環境変数を設定する
  if (process.env.OPENMANUS_SKIP_DEPS !== 'true') {
    await installPythonDependencies();
  }

  // MCPサーバーを起動
  startMCPServer();
};

// エントリーポイント
main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
