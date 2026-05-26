import React, { useState } from 'react';
import type { Config, MonitorStatus } from '../types';
import { Bell, Play, Square, RefreshCcw, ChevronDown, Check, AlertTriangle, Key, Lock } from 'lucide-react';

interface MonitorPanelProps {
  config: Config;
  status: MonitorStatus | null;
  currentExamIdx: number;
  adminKey: string;
  onSetAdminKey: (key: string) => void;
  onClearAdminKey: () => void;
  onToggle: () => void;
  onCheckNow: () => void;
  onSaveConfig: (fields: Partial<Config>) => Promise<void>;
  onSendTelegram: (examIdx: number, token: string, chatId: string) => Promise<void>;
}

export default function MonitorPanel({
  config,
  status,
  currentExamIdx,
  adminKey,
  onSetAdminKey,
  onClearAdminKey,
  onToggle,
  onCheckNow,
  onSaveConfig,
  onSendTelegram,
}: MonitorPanelProps) {
  const [showTg, setShowTg] = useState(false);
  const [tgToken, setTgToken] = useState(config.tg_token || '');
  const [tgChatId, setTgChatId] = useState(config.tg_chat_id || '');
  const [interval, setIntervalVal] = useState(config.monitor_interval || 3600);
  const [saving, setSaving] = useState(false);
  const [sendingTg, setSendingTg] = useState(false);
  const [tgStatus, setTgStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');

  // Sync inputs with config props when config updates
  React.useEffect(() => {
    if (config.tg_token) setTgToken(config.tg_token);
    if (config.tg_chat_id) setTgChatId(config.tg_chat_id);
    if (config.monitor_interval) setIntervalVal(config.monitor_interval);
  }, [config]);

  const handleSetKey = () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyError('请输入 API 密钥');
      return;
    }
    onSetAdminKey(trimmed);
    setKeyInput('');
    setKeyError('');
  };

  const handleIntervalChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseInt(e.target.value);
    setIntervalVal(val);
    setSaving(true);
    try {
      await onSaveConfig({ monitor_interval: val });
    } finally {
      setSaving(false);
    }
  };

  const handleBlurSave = async () => {
    await onSaveConfig({
      tg_token: tgToken,
      tg_chat_id: tgChatId,
    });
  };

  const handleTelegramSend = async () => {
    if (!tgToken.trim() || !tgChatId.trim()) {
      setTgStatus({ type: 'err', msg: '请填写 Bot Token 和 Chat ID' });
      return;
    }
    if (currentExamIdx < 0) {
      setTgStatus({ type: 'err', msg: '请在上方选择一次考试进行发送' });
      return;
    }
    setSendingTg(true);
    setTgStatus(null);
    try {
      await onSendTelegram(currentExamIdx, tgToken, tgChatId);
      setTgStatus({ type: 'ok', msg: '通知已成功发送至 Telegram!' });
    } catch (e: any) {
      setTgStatus({ type: 'err', msg: e.message || '发送失败' });
    } finally {
      setSendingTg(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const isRunning = status?.running || false;
  const hasKey = !!adminKey;

  return (
    <div className="bg-white dark:bg-apple-bg-darkSec border border-neutral-100 dark:border-neutral-900 rounded-2xl p-6 space-y-6 animate-fade-in">
      {/* Admin Key Section */}
      {hasKey ? (
        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500 bg-emerald-500/5 border border-emerald-500/10 rounded-xl px-4 py-2.5">
          <Key size={12} />
          <span className="font-medium">API 密钥已验证</span>
          <button
            onClick={onClearAdminKey}
            className="ml-auto text-apple-text-lightSecondary dark:text-apple-text-darkSecondary hover:text-red-500 apple-transition"
          >
            清除
          </button>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-500">
            <Lock size={12} />
            管理功能需要 API 密钥认证
          </div>
          <p className="text-[11px] text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
            请从服务器启动日志或 config.json 中获取 api_key，输入后即可使用监测与通知功能。
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); setKeyError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSetKey(); }}
              placeholder="输入 API 密钥..."
              className="flex-1 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-transparent text-sm text-apple-text-lightPrimary dark:text-apple-text-darkPrimary placeholder-neutral-400 focus:outline-none focus:border-amber-500 apple-transition"
            />
            <button
              onClick={handleSetKey}
              className="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-500 text-xs font-semibold hover:bg-amber-500/20 apple-transition"
            >
              验证
            </button>
          </div>
          {keyError && <p className="text-[11px] text-red-500">{keyError}</p>}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-neutral-400'}`} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
              持久化监测服务
            </h3>
            <p className="text-xs text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mt-0.5">
              后台自动轮询成绩，发现新发布或变化时自动通知
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onToggle}
            disabled={!hasKey}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold apple-transition
              ${
                isRunning
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20'
                  : 'bg-apple-text-lightPrimary dark:bg-apple-text-darkPrimary text-apple-bg-light dark:text-apple-bg-dark hover:opacity-90'
              }
              disabled:opacity-30 disabled:cursor-not-allowed
            `}
          >
            {isRunning ? (
              <>
                <Square size={10} className="fill-current" />
                停止监测
              </>
            ) : (
              <>
                <Play size={10} className="fill-current" />
                启动监测
              </>
            )}
          </button>
          <button
            onClick={onCheckNow}
            disabled={!hasKey}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary hover:bg-neutral-50 dark:hover:bg-neutral-900/50 apple-transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RefreshCcw size={10} />
            立即检查
          </button>
        </div>
      </div>

      {/* Grid Status Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/10 border border-neutral-100/50 dark:border-neutral-900/50">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-1">
            检查间隔
          </span>
          <select
            value={interval}
            onChange={handleIntervalChange}
            disabled={saving || !hasKey}
            className="bg-transparent text-sm font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary focus:outline-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <option value="1800">30 分钟</option>
            <option value="3600">1 小时</option>
            <option value="7200">2 小时</option>
            <option value="21600">6 小时</option>
            <option value="43200">12 小时</option>
          </select>
        </div>

        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-1">
            上次运行检查时间
          </span>
          <span className="text-sm font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
            {status ? formatDate(status.last_check) : '—'}
          </span>
        </div>

        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-1">
            下次计划运行时间
          </span>
          <span className="text-sm font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
            {status ? formatDate(status.next_check) : '—'}
          </span>
        </div>
      </div>

      {/* Monitor error message */}
      {status?.last_error && (
        <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/10 text-xs text-red-500 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">最近监测故障:</span>
            {status.last_error}
          </div>
        </div>
      )}

      {/* Collapsible Telegram Notification Settings */}
      <div className="border-t border-neutral-100 dark:border-neutral-900 pt-4">
        <button
          onClick={() => setShowTg(!showTg)}
          className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary hover:text-apple-text-lightPrimary dark:hover:text-apple-text-darkPrimary apple-transition py-1.5 focus:outline-none"
        >
          <span className="flex items-center gap-1.5">
            <Bell size={12} />
            Telegram 通知设置
          </span>
          <ChevronDown size={14} className={`apple-transition ${showTg ? 'rotate-180' : ''}`} />
        </button>

        {showTg && (
          <div className="space-y-4 pt-4 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mb-1.5">
                  Bot Token
                </label>
                <input
                  type="text"
                  value={tgToken}
                  onChange={(e) => setTgToken(e.target.value)}
                  onBlur={handleBlurSave}
                  disabled={!hasKey}
                  placeholder="123456789:ABCdefGhI..."
                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-transparent text-apple-text-lightPrimary dark:text-apple-text-darkPrimary placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-apple-blue-light dark:focus:border-apple-blue-dark apple-transition text-xs disabled:opacity-30"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mb-1.5">
                  Chat ID
                </label>
                <input
                  type="text"
                  value={tgChatId}
                  onChange={(e) => setTgChatId(e.target.value)}
                  onBlur={handleBlurSave}
                  disabled={!hasKey}
                  placeholder="例如: 987654321"
                  className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-transparent text-apple-text-lightPrimary dark:text-apple-text-darkPrimary placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-apple-blue-light dark:focus:border-apple-blue-dark apple-transition text-xs disabled:opacity-30"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <span className="text-[10px] text-apple-text-lightSecondary dark:text-apple-text-darkSecondary max-w-sm">
                输入后将在移开焦点(Blur)时自动保存。填好后，点击右侧按钮即可推送当前所选考试的详情消息。
              </span>

              <button
                type="button"
                onClick={handleTelegramSend}
                disabled={sendingTg || !tgToken.trim() || !tgChatId.trim() || !hasKey}
                className="px-4 py-2 rounded-full border border-apple-blue-light dark:border-apple-blue-dark text-apple-blue-light dark:text-apple-blue-dark hover:bg-apple-blue-light/5 dark:hover:bg-apple-blue-dark/5 text-xs font-semibold apple-transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {sendingTg ? (
                  <>
                    <RefreshCcw size={12} className="animate-spin" />
                    正在发送...
                  </>
                ) : (
                  '发送所选成绩'
                )}
              </button>
            </div>

            {tgStatus && (
              <div
                className={`p-3.5 rounded-xl text-xs flex items-center gap-2
                  ${
                    tgStatus.type === 'ok'
                      ? 'bg-emerald-500/5 border border-emerald-500/10 text-emerald-600 dark:text-emerald-500'
                      : 'bg-red-500/5 border border-red-500/10 text-red-500'
                  }
                `}
              >
                {tgStatus.type === 'ok' && <Check size={14} />}
                <span>{tgStatus.msg}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
