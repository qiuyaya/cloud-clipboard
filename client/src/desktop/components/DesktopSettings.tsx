import React, { useState } from "react";
import { useDesktop } from "../desktop-integration";

export const DesktopSettings: React.FC = () => {
  const { config, updateConfig, isDesktop } = useDesktop();
  const [tempConfig, setTempConfig] = useState(config);

  if (!isDesktop || !config) {
    return null;
  }

  const handleSave = async () => {
    if (tempConfig) {
      await updateConfig(tempConfig);
    }
  };

  const handleReset = () => {
    setTempConfig(config);
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6">桌面应用设置</h2>

      <div className="space-y-4">
        {/* 服务器地址 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">服务器地址</label>
          <input
            type="url"
            value={tempConfig?.server_url || ""}
            onChange={(e) =>
              setTempConfig((prev) => (prev ? { ...prev, server_url: e.target.value } : null))
            }
            placeholder="http://localhost:3001"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 自动剪切板监听 */}
        <div className="flex items-center">
          <input
            type="checkbox"
            id="auto-clipboard"
            checked={tempConfig?.auto_clipboard || false}
            onChange={(e) =>
              setTempConfig((prev) => (prev ? { ...prev, auto_clipboard: e.target.checked } : null))
            }
            className="mr-2"
          />
          <label htmlFor="auto-clipboard" className="text-sm text-gray-700">
            自动监听剪切板变化
          </label>
        </div>

        {/* 同步间隔 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">同步间隔 (毫秒)</label>
          <input
            type="number"
            min="500"
            max="10000"
            step="500"
            value={tempConfig?.sync_interval || 1000}
            onChange={(e) =>
              setTempConfig((prev) =>
                prev ? { ...prev, sync_interval: parseInt(e.target.value) } : null,
              )
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 主题 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">主题</label>
          <select
            value={tempConfig?.theme || "light"}
            onChange={(e) =>
              setTempConfig((prev) => (prev ? { ...prev, theme: e.target.value } : null))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="system">跟随系统</option>
          </select>
        </div>

        {/* 语言 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">语言</label>
          <select
            value={tempConfig?.language || "zh"}
            onChange={(e) =>
              setTempConfig((prev) => (prev ? { ...prev, language: e.target.value } : null))
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>

        {/* 系统托盘 */}
        <div className="flex items-center">
          <input
            type="checkbox"
            id="enable-tray"
            checked={tempConfig?.enable_tray || false}
            onChange={(e) =>
              setTempConfig((prev) => (prev ? { ...prev, enable_tray: e.target.checked } : null))
            }
            className="mr-2"
          />
          <label htmlFor="enable-tray" className="text-sm text-gray-700">
            显示系统托盘图标
          </label>
        </div>

        {/* 开机启动 */}
        <div className="flex items-center">
          <input
            type="checkbox"
            id="autostart"
            checked={tempConfig?.autostart || false}
            onChange={(e) =>
              setTempConfig((prev) => (prev ? { ...prev, autostart: e.target.checked } : null))
            }
            className="mr-2"
          />
          <label htmlFor="autostart" className="text-sm text-gray-700">
            开机自动启动
          </label>
        </div>
      </div>

      {/* 按钮 */}
      <div className="flex space-x-3 mt-6">
        <button
          onClick={handleSave}
          className="flex-1 bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          保存设置
        </button>
        <button
          onClick={handleReset}
          className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          重置
        </button>
      </div>
    </div>
  );
};
