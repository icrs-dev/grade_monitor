import React, { useState, useEffect } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

interface CaptchaInputProps {
  captchaImg: string;
  captchaText: string;
  ocrAvailable: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onBack: () => void;
  onSubmit: (captcha: string) => void;
}

export default function CaptchaInput({
  captchaImg,
  captchaText,
  ocrAvailable,
  loading,
  error,
  onRefresh,
  onBack,
  onSubmit,
}: CaptchaInputProps) {
  const [captcha, setCaptcha] = useState(captchaText);

  // Sync captcha state with OCR recognized text when it changes
  useEffect(() => {
    setCaptcha(captchaText);
  }, [captchaText]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (captcha.trim().length !== 4) {
      return;
    }
    onSubmit(captcha.trim());
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 animate-fade-in">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-semibold tracking-tight text-apple-text-lightPrimary dark:text-apple-text-darkPrimary mb-3">
          安全验证
        </h2>
        <p className="text-sm text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
          请输入验证码以验证安全登录
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-6 rounded-2xl border border-neutral-100 dark:border-neutral-900 bg-white dark:bg-apple-bg-darkSec">
          <button
            type="button"
            onClick={onRefresh}
            title="点击刷新验证码"
            className="group relative flex items-center justify-center shrink-0 w-32 h-14 bg-neutral-50 dark:bg-neutral-950 border border-neutral-100 dark:border-neutral-900 rounded-xl overflow-hidden cursor-pointer focus:outline-none"
          >
            {captchaImg ? (
              <img src={captchaImg} alt="验证码" className="w-full h-full object-contain" />
            ) : (
              <Loader2 className="animate-spin w-5 h-5 text-neutral-400" />
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 apple-transition flex items-center justify-center">
              <RefreshCw size={16} className="text-white animate-spin-hover" />
            </div>
          </button>

          <div className="w-full">
            <label className="block text-xs font-semibold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mb-1.5 text-center sm:text-left">
              输入验证码（4位）
            </label>
            <input
              type="text"
              maxLength={4}
              value={captcha}
              onChange={(e) => setCaptcha(e.target.value.toUpperCase())}
              placeholder="ABCD"
              className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 text-apple-text-lightPrimary dark:text-apple-text-darkPrimary text-center text-lg tracking-widest font-semibold placeholder-neutral-300 dark:placeholder-neutral-700 focus:outline-none focus:border-apple-blue-light dark:focus:border-apple-blue-dark focus:bg-white dark:focus:bg-black apple-transition"
              autoComplete="off"
            />
          </div>
        </div>

        {ocrAvailable && captchaText && (
          <p className="text-xs text-emerald-600 dark:text-emerald-500 font-medium text-center">
            OCR 自动识别: <span className="font-bold tracking-wider">{captchaText}</span>（可手动修改）
          </p>
        )}

        {error && (
          <p className="text-xs text-red-500 font-medium text-center">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 px-4 py-3 rounded-full border border-neutral-200 dark:border-neutral-800 text-sm font-medium text-apple-text-lightPrimary dark:text-apple-text-darkPrimary hover:bg-neutral-50 dark:hover:bg-neutral-900/50 apple-transition"
          >
            上一步
          </button>
          <button
            type="submit"
            disabled={captcha.trim().length !== 4 || loading}
            className="flex-1 px-4 py-3 rounded-full bg-apple-text-lightPrimary dark:bg-apple-text-darkPrimary text-apple-bg-light dark:text-apple-bg-dark text-sm font-semibold hover:opacity-90 active:scale-98 apple-transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin w-4 h-4" />
                正在登录...
              </>
            ) : (
              '验证登录'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
