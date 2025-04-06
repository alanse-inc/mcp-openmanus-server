import threading
import tomllib
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


def get_project_root() -> Path:
    """Get the project root directory"""
    return Path(__file__).resolve().parent.parent


PROJECT_ROOT = get_project_root()
WORKSPACE_ROOT = PROJECT_ROOT / "workspace"


class LLMSettings(BaseModel):
    model: str = Field(..., description="Model name")
    base_url: str = Field(..., description="API base URL")
    api_key: str = Field(..., description="API key")
    max_tokens: int = Field(4096, description="Maximum number of tokens per request")
    max_input_tokens: Optional[int] = Field(
        None,
        description="Maximum input tokens to use across all requests (None for unlimited)",
    )
    temperature: float = Field(1.0, description="Sampling temperature")
    api_type: str = Field(..., description="Azure, Openai, or Ollama")
    api_version: str = Field(..., description="Azure Openai version if AzureOpenai")


class ProxySettings(BaseModel):
    server: str = Field(None, description="Proxy server address")
    username: Optional[str] = Field(None, description="Proxy username")
    password: Optional[str] = Field(None, description="Proxy password")


class SearchSettings(BaseModel):
    engine: str = Field(default="Google", description="Search engine the llm to use")
    fallback_engines: List[str] = Field(
        default_factory=lambda: ["DuckDuckGo", "Baidu", "Bing"],
        description="Fallback search engines to try if the primary engine fails",
    )
    retry_delay: int = Field(
        default=60,
        description="Seconds to wait before retrying all engines again after they all fail",
    )
    max_retries: int = Field(
        default=3,
        description="Maximum number of times to retry all engines when all fail",
    )
    lang: str = Field(
        default="en",
        description="Language code for search results (e.g., en, zh, fr)",
    )
    country: str = Field(
        default="us",
        description="Country code for search results (e.g., us, cn, uk)",
    )


class BrowserSettings(BaseModel):
    headless: bool = Field(False, description="Whether to run browser in headless mode")
    disable_security: bool = Field(
        True, description="Disable browser security features"
    )
    extra_chromium_args: List[str] = Field(
        default_factory=list, description="Extra arguments to pass to the browser"
    )
    chrome_instance_path: Optional[str] = Field(
        None, description="Path to a Chrome instance to use"
    )
    wss_url: Optional[str] = Field(
        None, description="Connect to a browser instance via WebSocket"
    )
    cdp_url: Optional[str] = Field(
        None, description="Connect to a browser instance via CDP"
    )
    proxy: Optional[ProxySettings] = Field(
        None, description="Proxy settings for the browser"
    )
    max_content_length: int = Field(
        2000, description="Maximum length for content retrieval operations"
    )


class SandboxSettings(BaseModel):
    """Configuration for the execution sandbox"""

    use_sandbox: bool = Field(False, description="Whether to use the sandbox")
    image: str = Field("python:3.12-slim", description="Base image")
    work_dir: str = Field("/workspace", description="Container working directory")
    memory_limit: str = Field("512m", description="Memory limit")
    cpu_limit: float = Field(1.0, description="CPU limit")
    timeout: int = Field(300, description="Default command timeout (seconds)")
    network_enabled: bool = Field(
        False, description="Whether network access is allowed"
    )


class MCPSettings(BaseModel):
    """Configuration for MCP (Model Context Protocol)"""

    server_reference: str = Field(
        "app.mcp.server", description="Module reference for the MCP server"
    )


class AppConfig(BaseModel):
    llm: Dict[str, LLMSettings]
    sandbox: Optional[SandboxSettings] = Field(
        None, description="Sandbox configuration"
    )
    browser_config: Optional[BrowserSettings] = Field(
        None, description="Browser configuration"
    )
    search_config: Optional[SearchSettings] = Field(
        None, description="Search configuration"
    )
    mcp_config: Optional[MCPSettings] = Field(None, description="MCP configuration")

    class Config:
        arbitrary_types_allowed = True


class Config:
    _instance = None
    _lock = threading.Lock()
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not self._initialized:
            with self._lock:
                if not self._initialized:
                    self._config = None
                    self._load_initial_config()
                    self._initialized = True

    @staticmethod
    def _get_config_path() -> Path:
        root = PROJECT_ROOT
        config_path = root / "config" / "config.toml"
        if config_path.exists():
            return config_path
        example_path = root / "config" / "config.example.toml"
        if example_path.exists():
            return example_path
        raise FileNotFoundError("No configuration file found in config directory")

    def _load_config(self) -> dict:
        config_path = self._get_config_path()
        try:
            with config_path.open("rb") as f:
                return tomllib.load(f)
        except tomllib.TOMLDecodeError as e:
            # TOMLパースエラーが発生した場合、詳細なエラー情報を出力
            print(f"設定ファイルのパースエラー（{config_path}）: {e}")
            print("デフォルト設定を使用します")
            # 最小限の設定を返す
            return {
                "llm": {
                    "model": "gpt-4o",
                    "base_url": "https://api.openai.com/v1",
                    "api_key": "",
                    "max_tokens": 4096,
                    "temperature": 0.7,
                    "api_type": "openai",
                    "api_version": ""
                },
                "browser": {
                    "headless": True,
                    "disable_security": True,
                    "timeout": 30000,
                    "retry_count": 3,
                    "retry_delay": 1000
                },
                "search": {
                    "engine": "Google",
                    "engine_url": "https://www.google.com",
                    "lang": "ja",
                    "country": "jp"
                },
                "mcp": {
                    "server_reference": "app.mcp.server"
                }
            }

    def _load_initial_config(self):
        try:
            raw_config = self._load_config()
            base_llm = raw_config.get("llm", {})
            llm_overrides = {
                k: v for k, v in raw_config.get("llm", {}).items() if isinstance(v, dict)
            }

            # LLM設定に必須項目がない場合のデフォルト値
            default_settings = {
                "model": base_llm.get("model", "gpt-4o"),
                "base_url": base_llm.get("base_url", "https://api.openai.com/v1"),
                "api_key": base_llm.get("api_key", ""),
                "max_tokens": base_llm.get("max_tokens", 4096),
                "max_input_tokens": base_llm.get("max_input_tokens"),
                "temperature": base_llm.get("temperature", 1.0),
                "api_type": base_llm.get("api_type", "openai"),
                "api_version": base_llm.get("api_version", ""),
            }

            # handle browser config.
            browser_config = raw_config.get("browser", {})
            browser_settings = None

            if browser_config:
                # handle proxy settings.
                proxy_config = browser_config.get("proxy", {})
                proxy_settings = None

                if proxy_config and proxy_config.get("server"):
                    proxy_settings = ProxySettings(
                        **{
                            k: v
                            for k, v in proxy_config.items()
                            if k in ["server", "username", "password"] and v
                        }
                    )

                # filter valid browser config parameters.
                valid_browser_params = {
                    k: v
                    for k, v in browser_config.items()
                    if k in BrowserSettings.__annotations__ and v is not None
                }

                # if there is proxy settings, add it to the parameters.
                if proxy_settings:
                    valid_browser_params["proxy"] = proxy_settings

                # only create BrowserSettings when there are valid parameters.
                if valid_browser_params:
                    try:
                        browser_settings = BrowserSettings(**valid_browser_params)
                    except Exception as e:
                        print(f"ブラウザ設定のパースエラー: {e}")
                        browser_settings = BrowserSettings(
                            headless=True,
                            disable_security=True,
                            extra_chromium_args=[]
                        )

            search_config = raw_config.get("search", {})
            search_settings = None
            if search_config:
                try:
                    search_settings = SearchSettings(**search_config)
                except Exception as e:
                    print(f"検索設定のパースエラー: {e}")
                    search_settings = SearchSettings(
                        engine="Google",
                        engine_url="https://www.google.com",
                        lang="ja",
                        country="jp"
                    )

            sandbox_config = raw_config.get("sandbox", {})
            try:
                if sandbox_config:
                    sandbox_settings = SandboxSettings(**sandbox_config)
                else:
                    sandbox_settings = SandboxSettings()
            except Exception as e:
                print(f"サンドボックス設定のパースエラー: {e}")
                sandbox_settings = SandboxSettings()

            mcp_config = raw_config.get("mcp", {})
            try:
                if mcp_config:
                    mcp_settings = MCPSettings(**mcp_config)
                else:
                    mcp_settings = MCPSettings()
            except Exception as e:
                print(f"MCP設定のパースエラー: {e}")
                mcp_settings = MCPSettings()

            config_dict = {
                "llm": {
                    "default": default_settings,
                    **{
                        name: {**default_settings, **override_config}
                        for name, override_config in llm_overrides.items()
                    },
                },
                "sandbox": sandbox_settings,
                "browser_config": browser_settings,
                "search_config": search_settings,
                "mcp_config": mcp_settings,
            }

            try:
                self._config = AppConfig(**config_dict)
            except Exception as e:
                print(f"設定の適用エラー: {e}")
                # 最小限の設定で AppConfig を作成
                self._config = AppConfig(
                    llm={"default": default_settings},
                    sandbox=sandbox_settings,
                    mcp_config=mcp_settings
                )
        except Exception as e:
            print(f"設定の初期化中にエラーが発生しました: {e}")
            # 最小限の設定でフォールバック
            default_llm_settings = LLMSettings(
                model="gpt-4o",
                base_url="https://api.openai.com/v1",
                api_key="",
                max_tokens=4096,
                temperature=0.7,
                api_type="openai",
                api_version=""
            )
            default_mcp_settings = MCPSettings()
            default_sandbox_settings = SandboxSettings()

            self._config = AppConfig(
                llm={"default": default_llm_settings},
                sandbox=default_sandbox_settings,
                mcp_config=default_mcp_settings
            )

    @property
    def llm(self) -> Dict[str, LLMSettings]:
        return self._config.llm

    @property
    def sandbox(self) -> SandboxSettings:
        return self._config.sandbox

    @property
    def browser_config(self) -> Optional[BrowserSettings]:
        return self._config.browser_config

    @property
    def search_config(self) -> Optional[SearchSettings]:
        return self._config.search_config

    @property
    def mcp_config(self) -> MCPSettings:
        """Get the MCP configuration"""
        return self._config.mcp_config

    @property
    def workspace_root(self) -> Path:
        """Get the workspace root directory"""
        return WORKSPACE_ROOT

    @property
    def root_path(self) -> Path:
        """Get the root path of the application"""
        return PROJECT_ROOT

    def reload_config(self):
        """設定ファイルを再読み込みして、実行中のアプリケーションに適用します。"""
        with self._lock:
            try:
                old_config = self._config
                self._load_initial_config()
                print("設定を再読み込みしました")
                return True
            except Exception as e:
                print(f"設定の再読み込み中にエラーが発生しました: {e}")
                # エラーが発生した場合は以前の設定を保持
                self._config = old_config
                return False


config = Config()
