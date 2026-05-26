import { useState, useEffect } from 'react';
import { api, getAdminKey, setAdminKey, clearAdminKey, getSessionId, setSessionId, clearSessionId } from './api';
import type {
  Config,
  MonitorStatus,
  Exam,
  StudentInfo,
  ScoreDetail,
  TrendExamPoint,
} from './types';
import ThemeToggle from './components/ThemeToggle';
import StepIndicator from './components/StepIndicator';
import OrgSelect from './components/OrgSelect';
import LoginCredentials from './components/LoginCredentials';
import CaptchaInput from './components/CaptchaInput';
import StudentInfoCard from './components/StudentInfoCard';
import ExamList from './components/ExamList';
import ScoreDetailPanel from './components/ScoreDetailPanel';
import TrendChart from './components/TrendChart';
import MonitorPanel from './components/MonitorPanel';
import Toast from './components/Toast';
import { Loader2, LogOut, ChevronUp, ChevronDown, Compass } from 'lucide-react';

export default function App() {
  // App navigation state
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'info' | 'ok' | 'err'>('info');

  // Multi-step form values
  const [sid, setSid] = useState<string | null>(getSessionId());
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedOrgName, setSelectedOrgName] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [rememberMe, setRememberMe] = useState<boolean>(true);

  // Captcha state
  const [captchaImg, setCaptchaImg] = useState<string>('');
  const [captchaText, setCaptchaText] = useState<string>('');
  const [ocrAvailable, setOcrAvailable] = useState<boolean>(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);

  // Dashboard state (Step 4)
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [school, setSchool] = useState<string>('');
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamIdx, setSelectedExamIdx] = useState<number>(-1);
  const [scoreDetail, setScoreDetail] = useState<ScoreDetail | null>(null);
  const [loadingScore, setLoadingScore] = useState<boolean>(false);
  const [isCachedData, setIsCachedData] = useState<boolean>(false);

  // Trend chart state
  const [showTrend, setShowTrend] = useState<boolean>(false);
  const [trendData, setTrendData] = useState<TrendExamPoint[]>([]);
  const [loadingTrend, setLoadingTrend] = useState<boolean>(false);

  // Persistent monitor state
  const [config, setConfig] = useState<Config | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);

  // Admin key for protected endpoints
  const [adminKey, setAdminKeyState] = useState<string>(getAdminKey() || '');

  // Toast trigger helper
  const showToast = (msg: string, type: 'info' | 'ok' | 'err' = 'info') => {
    setToastMsg(msg);
    setToastType(type);
  };

  // Admin key management
  const handleSetAdminKey = (key: string) => {
    setAdminKey(key);
    setAdminKeyState(key);
  };

  const handleClearAdminKey = () => {
    clearAdminKey();
    setAdminKeyState('');
  };

  // Initialize config, monitor status
  useEffect(() => {
    async function init() {
      // 1. Fetch saved config
      try {
        const cfg = await api<Config>('/api/config');
        setConfig(cfg);
        if (cfg.org_id) {
          setSelectedOrgId(cfg.org_id);
        }
        if (cfg.username) setUsername(cfg.username);
        // Pre-fill rememberMe if data exists
        if (cfg.username && cfg.org_id) {
          setRememberMe(true);
        }
      } catch (e) {
        console.error('Failed to load saved config', e);
      }

      // 2. Fetch Monitor Status & Cached scores
      try {
        const st = await api<MonitorStatus>('/api/monitor/status');
        setMonitorStatus(st);

        // Auto-load cached scores if they exist and user is not logged in yet
        if (st.has_scores && st.last_scores) {
          const cached = st.last_scores;
          setStudent(cached.student);
          setSchool(cached.school);
          setIsCachedData(true);

          // Map cached exams to Exam list
          const mappedExams = cached.exams.map((e: any) => {
            const hasDetail = e.total_score !== undefined && e.total_score !== '';
            return {
              ksdm: '',
              kldm: '',
              name: e.exam_name,
              date: e.exam_date || '',
              class_rank: e.class_rank || '',
              grade_rank: e.grade_rank || '',
              subjects: (e.subjects || []).map((s: any) => s.name).join(' '),
              _cached: hasDetail,
              _cachedData: hasDetail ? e : null,
            };
          });

          setExams(mappedExams);
          setCurrentStep(4);
        }
      } catch (e) {
        console.error('Failed to load monitor status', e);
      }

      // 3. Restore session if exists (survives page refresh)
      const storedSid = getSessionId();
      if (storedSid) {
        try {
          const examRes = await api<{ student: StudentInfo; school: string; exams: Exam[] }>(
            `/api/exams?session_id=${storedSid}`
          );
          setStudent(examRes.student);
          setSchool(examRes.school);
          setExams(examRes.exams);
          setSid(storedSid);
          setCurrentStep(4);
        } catch {
          clearSessionId();
        }
      }
    }

    init();

    // Start background status polling
    const timer = window.setInterval(async () => {
      try {
        const st = await api<MonitorStatus>('/api/monitor/status');
        setMonitorStatus(st);
      } catch {
        // Silent poll error
      }
    }, 30000);

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, []);

  // Sync selected school name when school list loads or selection changes
  useEffect(() => {
    if (selectedOrgId && !selectedOrgName) {
      async function resolveOrgName() {
        try {
          const data = await api<{ orgs: any[] }>('/api/organizations');
          const matched = data.orgs.find((o) => o.id === selectedOrgId);
          if (matched) setSelectedOrgName(matched.name);
        } catch {
          // ignore
        }
      }
      resolveOrgName();
    }
  }, [selectedOrgId, selectedOrgName]);

  // Step 1 -> Step 2
  const handleOrgSelect = (orgId: string, orgName: string) => {
    setSelectedOrgId(orgId);
    setSelectedOrgName(orgName);
    setCurrentStep(2);
  };

  // Step 2 -> Step 3: Trigger Session & Captcha Fetch
  const handleCredentialsSubmit = async (uname: string, pword: string, remember: boolean) => {
    setUsername(uname);
    setPassword(pword);
    setRememberMe(remember);
    setLoading(true);

    try {
      let activeSid = sid;
      if (!activeSid) {
        const sdata = await api<{ session_id: string }>('/api/session', { method: 'POST' });
        activeSid = sdata.session_id;
        setSid(activeSid);
        setSessionId(activeSid);
      }

      const form = new FormData();
      form.append('session_id', activeSid);
      const cap = await api<{ captcha_image: string; captcha_text: string; ocr_available: boolean }>(
        '/api/captcha',
        { method: 'POST', body: form }
      );

      setCaptchaImg(cap.captcha_image);
      setCaptchaText(cap.captcha_text || '');
      setOcrAvailable(cap.ocr_available);
      setCaptchaError(null);
      setCurrentStep(3);
    } catch (e: any) {
      setSid(null);
      clearSessionId();
      showToast(e.message || '获取验证码失败，请重试', 'err');
    } finally {
      setLoading(false);
    }
  };

  // Refresh captcha inside Step 3
  const handleCaptchaRefresh = async () => {
    if (!sid) return;
    setCaptchaImg('');
    try {
      const form = new FormData();
      form.append('session_id', sid);
      const cap = await api<{ captcha_image: string; captcha_text: string; ocr_available: boolean }>(
        '/api/captcha',
        { method: 'POST', body: form }
      );
      setCaptchaImg(cap.captcha_image);
      setCaptchaText(cap.captcha_text || '');
      setOcrAvailable(cap.ocr_available);
      setCaptchaError(null);
    } catch (e: any) {
      showToast(e.message || '刷新验证码失败', 'err');
    }
  };

  // Step 3 -> Step 4: Login & Fetch Exams
  const handleCaptchaSubmit = async (captchaCode: string) => {
    if (!sid || !selectedOrgId) return;
    setLoading(true);
    setCaptchaError(null);

    try {
      const loginForm = new FormData();
      loginForm.append('session_id', sid);
      loginForm.append('org_id', selectedOrgId);
      loginForm.append('username', username);
      loginForm.append('password', password);
      loginForm.append('captcha', captchaCode);

      await api('/api/login', { method: 'POST', body: loginForm });

      // Save credentials if rememberMe is selected (requires admin key)
      if (rememberMe) {
        try {
          const configForm = new FormData();
          configForm.append('org_id', selectedOrgId);
          configForm.append('username', username);
          configForm.append('password', password);
          configForm.append('monitor_interval', String(config?.monitor_interval || 3600));
          configForm.append('tg_chat_id', config?.tg_chat_id || '');
          await api('/api/config', { method: 'POST', body: configForm });
          // Reload config
          const updatedCfg = await api<Config>('/api/config');
          setConfig(updatedCfg);
        } catch {
          // Credential save requires admin key — skip silently if not set
        }
      }

      // Fetch exams list
      const examRes = await api<{ student: StudentInfo; school: string; exams: Exam[] }>(
        `/api/exams?session_id=${sid}`
      );

      setStudent(examRes.student);
      setSchool(examRes.school);
      setExams(examRes.exams);
      setIsCachedData(false);
      setScoreDetail(null);
      setSelectedExamIdx(-1);
      setShowTrend(false);

      // Save list cache
      try {
        const scoreCache = {
          student: examRes.student,
          school: examRes.school,
          exams: examRes.exams.map((e) => ({
            exam_name: e.name,
            exam_date: e.date,
            class_rank: e.class_rank,
            grade_rank: e.grade_rank,
            subjects: [],
          })),
        };
        const cacheForm = new FormData();
        cacheForm.append('last_scores', JSON.stringify(scoreCache));
        await api('/api/config/scores', { method: 'POST', body: cacheForm });
      } catch {
        // ignore cache write error
      }

      // Load monitor status
      const updatedSt = await api<MonitorStatus>('/api/monitor/status');
      setMonitorStatus(updatedSt);

      setCurrentStep(4);
      showToast('登录成功', 'ok');
    } catch (e: any) {
      if (e.message.includes('验证码')) {
        // Reset session on captcha error to force a new captcha
        setSid(null);
        clearSessionId();
        setCaptchaError(e.message);
      } else {
        setCaptchaError(e.message || '登录失败，请检查账户或密码');
      }
    } finally {
      setLoading(false);
    }
  };

  // Load Score detail for clicked exam
  const handleExamSelect = async (idx: number) => {
    if (isNaN(idx) || !Number.isInteger(idx) || idx < 0) {
      console.error('handleExamSelect called with invalid index:', idx);
      return;
    }
    setSelectedExamIdx(idx);
    setLoadingScore(true);
    setScoreDetail(null);

    const exam = exams[idx];

    // If we have cached full details in local offline mode, use them immediately
    if (exam && exam._cached && exam._cachedData) {
      setScoreDetail({
        exam_name: exam._cachedData.exam_name,
        summary: {
          total_score: exam._cachedData.total_score,
          class_rank: exam._cachedData.class_rank,
          grade_rank: exam._cachedData.grade_rank,
          total_students: exam._cachedData.total_students,
          class_max: '',
          class_avg: '',
          class_min: '',
        },
        subjects: exam._cachedData.subjects || [],
        strengths: '',
        weaknesses: '',
        changes: [],
        classmates: [],
      });
      setLoadingScore(false);
      return;
    }

    if (!sid) {
      showToast('离线状态无法加载实时成绩，请先登录', 'info');
      setLoadingScore(false);
      return;
    }

    try {
      const data = await api<ScoreDetail>(`/api/scores/${idx}?session_id=${sid}`);
      setScoreDetail(data);
    } catch (e: any) {
      showToast(e.message || '加载详细成绩失败', 'err');
    } finally {
      setLoadingScore(false);
    }
  };

  // Toggle and load trend chart data
  const handleTrendToggle = async () => {
    const nextShow = !showTrend;
    setShowTrend(nextShow);
    if (!nextShow) return;

    setLoadingTrend(true);

    // If using cached data offline
    if (exams.length > 0 && exams[0]._cachedData) {
      const mappedTrend = exams.map((e) => ({
        exam_name: e.name,
        exam_date: e.date || '',
        total_score: e._cachedData ? parseFloat(e._cachedData.total_score) || 0 : 0,
        class_rank: e._cachedData ? parseInt(e._cachedData.class_rank) || 0 : 0,
        grade_rank: e._cachedData ? parseInt(e._cachedData.grade_rank) || 0 : 0,
        total_students: e._cachedData ? parseInt(e._cachedData.total_students) || 0 : 0,
        subjects: (e._cachedData?.subjects || []).map((s: any) => ({
          name: s.name,
          score: parseFloat(s.score) || 0,
        })),
      }));
      setTrendData(mappedTrend);
      setLoadingTrend(false);
      return;
    }

    if (!sid) {
      showToast('请登录以拉取最新趋势数据', 'info');
      setLoadingTrend(false);
      return;
    }

    try {
      const res = await api<{ exams: any[] }>(`/api/scores/all?session_id=${sid}`);
      const mappedTrend = res.exams.map((e: any) => ({
        exam_name: e.exam_name,
        exam_date: e.exam_date || '',
        total_score: parseFloat(e.total_score) || 0,
        class_rank: parseInt(e.class_rank) || 0,
        grade_rank: parseInt(e.grade_rank) || 0,
        total_students: parseInt(e.total_students) || 0,
        subjects: (e.subjects || []).map((s: any) => ({
          name: s.name,
          score: parseFloat(s.score) || 0,
        })),
      }));
      setTrendData(mappedTrend);
    } catch (e: any) {
      showToast(e.message || '加载趋势图失败', 'err');
      setShowTrend(false);
    } finally {
      setLoadingTrend(false);
    }
  };

  // Monitor controls
  const handleMonitorToggle = async () => {
    if (!monitorStatus) return;
    const isRunning = monitorStatus.running;

    try {
      if (isRunning) {
        await api('/api/monitor/stop', { method: 'POST' });
        showToast('监测服务已停止', 'info');
      } else {
        // Save current configs on start to verify credentials exist on backend
        await handleSaveConfig({});
        await api('/api/monitor/start', { method: 'POST' });
        showToast('监测服务已启动', 'ok');
      }
      const st = await api<MonitorStatus>('/api/monitor/status');
      setMonitorStatus(st);
    } catch (e: any) {
      showToast(e.message || '操作失败', 'err');
    }
  };

  const handleManualCheck = async () => {
    showToast('正在执行即时检查...', 'info');
    try {
      await handleSaveConfig({});
      const res = await api<{ changed: boolean }>('/api/monitor/check', { method: 'POST' });
      showToast(res.changed ? '检查完成：检测到成绩有更新!' : '检查完成：成绩无变化', res.changed ? 'ok' : 'info');
      const st = await api<MonitorStatus>('/api/monitor/status');
      setMonitorStatus(st);
    } catch (e: any) {
      showToast(e.message || '检查运行失败', 'err');
    }
  };

  const handleSaveConfig = async (fields: Partial<Config>) => {
    // Merge new fields
    const updated = {
      org_id: selectedOrgId || '',
      username: username,
      password: password,
      tg_token: config?.tg_token || '',
      tg_chat_id: config?.tg_chat_id || '',
      monitor_interval: config?.monitor_interval || 3600,
      ...fields,
    };

    const form = new FormData();
    form.append('org_id', updated.org_id);
    form.append('username', updated.username);
    // Don't send masked value
    if (updated.password && !updated.password.includes('***')) {
      form.append('password', updated.password);
    }
    if (updated.tg_token && !updated.tg_token.includes('***')) {
      form.append('tg_token', updated.tg_token);
    }
    form.append('tg_chat_id', updated.tg_chat_id);
    const interval = parseInt(String(updated.monitor_interval));
    form.append('monitor_interval', String(isNaN(interval) ? 3600 : interval));

    try {
      await api('/api/config', { method: 'POST', body: form });
      const cfg = await api<Config>('/api/config');
      setConfig(cfg);
    } catch (e: any) {
      showToast(e.message || '保存配置失败', 'err');
      throw e;
    }
  };

  const handleSendTelegram = async (examIdx: number, token: string, chatId: string) => {
    if (isNaN(examIdx) || !Number.isInteger(examIdx) || examIdx < 0) {
      throw new Error('考试编号无效');
    }
    // If has session, use standard tg dispatch
    if (sid) {
      try {
        const form = new FormData();
        form.append('session_id', sid);
        form.append('exam_index', String(examIdx));
        if (token && !token.includes('***')) form.append('tg_token', token);
        if (chatId) form.append('tg_chat_id', chatId);
        await api('/api/telegram', { method: 'POST', body: form });
        return;
      } catch (e: any) {
        if (!e.message.includes('会话') && !e.message.includes('登录')) {
          throw e;
        }
      }
    }

    // Fallback: send custom compiled cached message
    const exam = exams[examIdx];
    if (!exam || !exam._cachedData) {
      throw new Error('当前为离线模式且无缓存详情，无法发送');
    }

    const d = exam._cachedData;
    const lines = [];
    lines.push(`<b>${d.exam_name || exam.name}</b>`);
    lines.push(`总分: ${d.total_score || '?'}  班排: ${d.class_rank || '?'}/${d.total_students || '?'}  级排: ${d.grade_rank || '?'}`);
    if (d.subjects && d.subjects.length) {
      const subs = d.subjects.map((k: any) =>
        `${k.name}:${k.score || '-'}(B${k.class_rank || '-'}/G${k.grade_rank || '-'})`
      );
      lines.push(subs.join(' | '));
    }
    const msg = lines.join('\n');

    const form = new FormData();
    form.append('text', msg);
    if (token && !token.includes('***')) form.append('tg_token', token);
    if (chatId) form.append('tg_chat_id', chatId);

    await api('/api/telegram/send', { method: 'POST', body: form });
  };

  // Sign out / reset
  const handleLogout = () => {
    setSid(null);
    clearSessionId();
    setExams([]);
    setSelectedExamIdx(-1);
    setScoreDetail(null);
    setShowTrend(false);
    setIsCachedData(false);
    setCurrentStep(1);
    showToast('已安全退出登录', 'info');
  };

  return (
    <div className="min-h-screen bg-apple-bg-light dark:bg-apple-bg-dark text-apple-text-lightPrimary dark:text-apple-text-darkPrimary apple-transition selection:bg-apple-blue-light/10 dark:selection:bg-apple-blue-dark/20 flex flex-col justify-between">
      {/* Toast Alert */}
      <Toast message={toastMsg} type={toastType} onClose={() => setToastMsg(null)} />

      {/* Global Header */}
      <header className="border-b border-neutral-100 dark:border-neutral-900 bg-white/70 dark:bg-apple-bg-dark/70 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-apple-text-lightPrimary dark:text-apple-text-darkPrimary stroke-[1.5]" />
            <h1 className="text-lg font-semibold tracking-tight font-display">
              CloudMarking <span className="font-light text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">云阅卷</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {currentStep === 4 && (
              <button
                onClick={handleLogout}
                title="退出登录"
                className="p-2 rounded-full border border-neutral-200 dark:border-neutral-800 text-apple-text-lightPrimary dark:text-apple-text-darkPrimary hover:bg-neutral-50 dark:hover:bg-neutral-900 apple-transition flex items-center justify-center focus:outline-none"
              >
                <LogOut size={16} className="stroke-[1.5]" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Flow Container */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-12 md:py-20">
        {currentStep < 4 && (
          <div className="mb-8">
            <StepIndicator currentStep={currentStep} />
          </div>
        )}

        <div className="w-full">
          {/* STEP 1: Select Organization */}
          {currentStep === 1 && (
            <OrgSelect onSelect={handleOrgSelect} selectedOrgId={selectedOrgId} />
          )}

          {/* STEP 2: Credentials Form */}
          {currentStep === 2 && selectedOrgId && selectedOrgName && (
            <LoginCredentials
              orgId={selectedOrgId}
              orgName={selectedOrgName}
              onBack={() => setCurrentStep(1)}
              onNext={handleCredentialsSubmit}
              initialUsername={username}
              initialPassword={password}
            />
          )}

          {/* STEP 3: Captcha Form */}
          {currentStep === 3 && (
            <CaptchaInput
              captchaImg={captchaImg}
              captchaText={captchaText}
              ocrAvailable={ocrAvailable}
              loading={loading}
              error={captchaError}
              onRefresh={handleCaptchaRefresh}
              onBack={() => setCurrentStep(2)}
              onSubmit={handleCaptchaSubmit}
            />
          )}

          {/* STEP 4: Dashboard Score Results */}
          {currentStep === 4 && student && (
            <div className="space-y-8 animate-fade-in">
              {/* Student Metadata Card */}
              <StudentInfoCard student={student} school={school} isCached={isCachedData} />

              {/* Exam & Detail Flex Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Side: Exam List */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-900 pb-2">
                    <h3 className="text-sm font-semibold tracking-tight text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
                      考试里程碑 ({exams.length})
                    </h3>
                    <button
                      onClick={handleTrendToggle}
                      className="text-xs font-semibold text-apple-blue-light dark:text-apple-blue-dark hover:underline flex items-center gap-1.5 focus:outline-none"
                    >
                      {showTrend ? (
                        <>
                          <ChevronUp size={14} />
                          收起走势图
                        </>
                      ) : (
                        <>
                          <ChevronDown size={14} />
                          查看走势图
                        </>
                      )}
                    </button>
                  </div>

                  <ExamList
                    exams={exams}
                    selectedIdx={selectedExamIdx}
                    onSelect={handleExamSelect}
                  />
                </div>

                {/* Right Side: Score Breakdowns & Trends */}
                <div className="lg:col-span-7 space-y-6">
                  {/* Trend chart toggle */}
                  {showTrend && (
                    <div className="transition-all duration-300">
                      {loadingTrend ? (
                        <div className="bg-white dark:bg-apple-bg-darkSec border border-neutral-100 dark:border-neutral-900 rounded-2xl p-16 flex flex-col items-center justify-center text-neutral-400">
                          <Loader2 className="animate-spin mb-3 w-6 h-6 stroke-[1.5]" />
                          <span className="text-xs">加载数据中...</span>
                        </div>
                      ) : (
                        <TrendChart data={trendData} />
                      )}
                    </div>
                  )}

                  {/* Active Selected Exam Score Details */}
                  {selectedExamIdx >= 0 ? (
                    loadingScore ? (
                      <div className="bg-white dark:bg-apple-bg-darkSec border border-neutral-100 dark:border-neutral-900 rounded-2xl p-24 flex flex-col items-center justify-center text-neutral-400">
                        <Loader2 className="animate-spin mb-3 w-6 h-6 stroke-[1.5]" />
                        <span className="text-xs">正在分析考次数据...</span>
                      </div>
                    ) : (
                      scoreDetail && <ScoreDetailPanel data={scoreDetail} />
                    )
                  ) : (
                    <div className="h-64 rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center text-center p-6 text-apple-text-lightSecondary dark:text-apple-text-darkSecondary bg-neutral-50/20 dark:bg-neutral-900/10">
                      <span className="text-xs font-medium">请从左侧选择一次考试以查看详细得分及班级对比</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Background Monitor controls */}
              {config && (
                <div className="border-t border-neutral-100 dark:border-neutral-900 pt-8">
                  <MonitorPanel
                    config={config}
                    status={monitorStatus}
                    currentExamIdx={selectedExamIdx}
                    adminKey={adminKey}
                    onSetAdminKey={handleSetAdminKey}
                    onClearAdminKey={handleClearAdminKey}
                    onToggle={handleMonitorToggle}
                    onCheckNow={handleManualCheck}
                    onSaveConfig={handleSaveConfig}
                    onSendTelegram={handleSendTelegram}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Global Footnotes */}
      <footer className="border-t border-neutral-100 dark:border-neutral-900 py-8 bg-neutral-50 dark:bg-neutral-950">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-[10px] font-medium text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
          <div className="flex items-center gap-2">
            <span>© {new Date().getFullYear()} CloudMarking.</span>
            <span>Meticulously crafted frontend interface.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
