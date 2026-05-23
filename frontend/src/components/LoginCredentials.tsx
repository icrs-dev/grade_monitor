import React, { useState } from 'react';

interface LoginCredentialsProps {
  orgName: string;
  orgId: string;
  onBack: () => void;
  onNext: (username: string, password: string, remember: boolean) => void;
  initialUsername: string;
  initialPassword: string;
}

export default function LoginCredentials({
  orgName,
  orgId,
  onBack,
  onNext,
  initialUsername,
  initialPassword,
}: LoginCredentialsProps) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState(initialPassword);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('请输入学籍号和密码');
      return;
    }
    setError(null);
    onNext(username.trim(), password.trim(), remember);
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8 animate-fade-in">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-semibold tracking-tight text-apple-text-lightPrimary dark:text-apple-text-darkPrimary mb-3">
          登录您的账户
        </h2>
        <p className="text-sm text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
          已选择学校: <span className="font-medium text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">{orgName} ({orgId})</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mb-1.5">
              学籍号 / 考生号
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入您的学籍号"
              className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 text-apple-text-lightPrimary dark:text-apple-text-darkPrimary placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-apple-blue-light dark:focus:border-apple-blue-dark focus:bg-white dark:focus:bg-black apple-transition text-sm"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mb-1.5">
              账户密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={initialPassword ? '••••••••' : '输入您的密码'}
              className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 text-apple-text-lightPrimary dark:text-apple-text-darkPrimary placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-apple-blue-light dark:focus:border-apple-blue-dark focus:bg-white dark:focus:bg-black apple-transition text-sm"
              autoComplete="current-password"
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <input
            id="rememberMe"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-apple-blue-light dark:text-apple-blue-dark focus:ring-0 focus:ring-offset-0 cursor-pointer accent-apple-blue-light dark:accent-apple-blue-dark"
          />
          <label htmlFor="rememberMe" className="text-xs text-apple-text-lightSecondary dark:text-apple-text-darkSecondary cursor-pointer select-none">
            记住账户密码（登录成功后将自动保存）
          </label>
        </div>

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
            className="flex-1 px-4 py-3 rounded-full bg-apple-text-lightPrimary dark:bg-apple-text-darkPrimary text-apple-bg-light dark:text-apple-bg-dark text-sm font-semibold hover:opacity-90 active:scale-98 apple-transition"
          >
            获取验证码
          </button>
        </div>
      </form>
    </div>
  );
}
