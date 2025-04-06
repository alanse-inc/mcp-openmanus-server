"""
OpenManus設定操作ツール
MCPを通じてOpenManusの設定を取得・更新するためのツールです。
"""

import os
import json
from typing import Any, Dict, List, Optional, Union, ClassVar

from app.tool.base import BaseTool
from app.logger import logger


class ConfigTool(BaseTool):
    """
    OpenManusの設定を操作するためのMCPツール。
    config.tomlやその他の設定ファイルの内容を読み取ったり更新したりします。
    """

    name: ClassVar[str] = "config"
    description: ClassVar[str] = "OpenManusの設定を操作するツール。設定の取得や更新が可能です。"

    def __init__(self):
        super().__init__()
        self._nodejs_bridge = False

    async def execute(self, **kwargs) -> Any:
        """
        BaseTool抽象クラスから要求される抽象メソッドの実装。
        実行したいメソッドに基づいて適切な関数にディスパッチします。

        Args:
            **kwargs: キーワード引数
                     - method: 実行するメソッド名（'get_config', 'update_config', 'get_env_vars'）
                     - section: セクション名（get_configの場合）
                     - updates: 更新する設定（update_configの場合）

        Returns:
            実行結果
        """
        method = kwargs.get('method', 'get_config')

        if method == 'get_config':
            section = kwargs.get('section')
            return await self.get_config(section)
        elif method == 'update_config':
            updates = kwargs.get('updates', {})
            return await self.update_config(updates)
        elif method == 'get_env_vars':
            return await self.get_env_vars()
        else:
            return {"error": f"未知のメソッド: {method}"}

    async def get_config(self, section: Optional[str] = None) -> Dict[str, Any]:
        """
        OpenManusの設定を取得します。特定のセクションまたは全ての設定を取得できます。

        Args:
            section: 取得するセクション名。省略すると全ての設定を取得します。

        Returns:
            設定情報を含む辞書
        """
        try:
            # JavaScript側に公開されているAPIを呼び出す
            if not self._nodejs_bridge:
                logger.error("設定操作のためのNode.js連携が有効になっていません。")
                return {"error": "設定操作機能が利用できません。"}

            # Node.jsのグローバルオブジェクトにアクセス
            try:
                from node import global_ as nodejs_global

                if not hasattr(nodejs_global, "openmanusConfig") or not nodejs_global.openmanusConfig:
                    logger.error("openmanusConfig オブジェクトが見つかりません。")
                    return {"error": "openmanusConfig が利用できません。"}

                # Node.js側の関数を呼び出す
                config_data = nodejs_global.openmanusConfig.getConfig(section)
                return config_data
            except ImportError:
                logger.error("node モジュールをインポートできません。Node.js統合が無効です。")
                return {"error": "Node.js統合が利用できません。"}
        except Exception as e:
            logger.error(f"設定取得中にエラーが発生しました: {str(e)}")
            return {"error": str(e)}

    async def update_config(self, updates: Dict[str, str]) -> Dict[str, Any]:
        """
        OpenManusの設定を更新します。

        Args:
            updates: 更新する設定のキーと値のペアを含む辞書
                    例: {"llm.model": "gpt-4", "llm.temperature": "0.7"}

        Returns:
            更新結果を含む辞書
        """
        try:
            # JavaScript側に公開されているAPIを呼び出す
            if not self._nodejs_bridge:
                logger.error("設定操作のためのNode.js連携が有効になっていません。")
                return {"error": "設定操作機能が利用できません。"}

            # Node.jsのグローバルオブジェクトにアクセス
            try:
                from node import global_ as nodejs_global

                if not hasattr(nodejs_global, "openmanusConfig") or not nodejs_global.openmanusConfig:
                    logger.error("openmanusConfig オブジェクトが見つかりません。")
                    return {"error": "openmanusConfig が利用できません。"}

                # Node.js側の関数を呼び出す
                result = nodejs_global.openmanusConfig.updateConfig(updates)

                # 設定更新後にreload_configを呼び出してアプリケーション内の設定を更新
                try:
                    from app.config import config
                    if hasattr(config, "reload_config"):
                        config.reload_config()
                except Exception as reload_err:
                    logger.error(f"設定の再読み込み中にエラーが発生しました: {str(reload_err)}")

                return result
            except ImportError:
                logger.error("node モジュールをインポートできません。Node.js統合が無効です。")
                return {"error": "Node.js統合が利用できません。"}
        except Exception as e:
            logger.error(f"設定更新中にエラーが発生しました: {str(e)}")
            return {"error": str(e)}

    async def get_env_vars(self) -> Dict[str, str]:
        """
        OpenManusに関連する環境変数の設定値を取得します。

        Returns:
            環境変数の辞書
        """
        try:
            # JavaScript側に公開されているAPIを呼び出す
            if not self._nodejs_bridge:
                logger.error("設定操作のためのNode.js連携が有効になっていません。")
                return {"error": "設定操作機能が利用できません。"}

            # Node.jsのグローバルオブジェクトにアクセス
            try:
                from node import global_ as nodejs_global

                if not hasattr(nodejs_global, "openmanusConfig") or not nodejs_global.openmanusConfig:
                    logger.error("openmanusConfig オブジェクトが見つかりません。")
                    return {"error": "openmanusConfig が利用できません。"}

                # Node.js側の関数を呼び出す
                env_vars = nodejs_global.openmanusConfig.exportEnvVars()
                return env_vars
            except ImportError:
                logger.error("node モジュールをインポートできません。Node.js統合が無効です。")
                return {"error": "Node.js統合が利用できません。"}
        except Exception as e:
            logger.error(f"環境変数取得中にエラーが発生しました: {str(e)}")
            return {"error": str(e)}

    def _set_nodejs_bridge(self, enabled: bool = True) -> None:
        """Node.js連携を有効または無効にします（内部使用）"""
        self._nodejs_bridge = enabled
