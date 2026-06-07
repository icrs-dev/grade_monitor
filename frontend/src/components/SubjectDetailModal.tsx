import { useState, useEffect } from 'react';
import { api } from '../api';
import type { SubjectAnalysisResponse, AnswerSheetResponse } from '../types';
import { X, Loader2, FileText, CheckSquare } from 'lucide-react';

interface SubjectDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  examIndex: number;
  subjectCode: string;
  subjectName: string;
  sessionId: string | null;
}

export default function SubjectDetailModal({
  isOpen,
  onClose,
  examIndex,
  subjectCode,
  subjectName,
  sessionId,
}: SubjectDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'detail' | 'sheet'>('detail');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [analysis, setAnalysis] = useState<SubjectAnalysisResponse | null>(null);
  const [sheet, setSheet] = useState<AnswerSheetResponse | null>(null);

  useEffect(() => {
    if (!isOpen || !subjectCode || !sessionId) return;

    let isMounted = true;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setSheet(null);
    setActiveTab('detail');

    async function fetchData() {
      try {
        const [analysisData, sheetData] = await Promise.all([
          api<SubjectAnalysisResponse>(`/api/scores/${examIndex}/subject/${subjectCode}?session_id=${sessionId}`),
          api<AnswerSheetResponse>(`/api/scores/${examIndex}/sheet/${subjectCode}?session_id=${sessionId}`).catch(err => {
            console.warn('Failed to fetch answer sheet details:', err);
            return null; // Let detail succeed even if sheet API fails
          })
        ]);

        if (isMounted) {
          setAnalysis(analysisData);
          if (sheetData) {
            setSheet(sheetData);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || '获取学科明细失败');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, examIndex, subjectCode, sessionId]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Render score ratio indicators (Apple-style minimalist bars)
  const renderRatioBar = (ratioStr: string) => {
    const ratio = parseFloat(ratioStr.replace('%', '')) || 0;
    // Cap ratio between 0 and 100
    const percentage = Math.min(Math.max(ratio, 0), 100);

    return (
      <div className="flex items-center gap-2 w-full max-w-[120px]">
        <div className="flex-1 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-neutral-400 dark:bg-neutral-500 rounded-full"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-apple-text-lightSecondary dark:text-apple-text-darkSecondary min-w-[32px] text-right">
          {percentage.toFixed(0)}%
        </span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-4xl h-[85vh] flex flex-col bg-white dark:bg-apple-bg-darkSec border border-neutral-100 dark:border-neutral-900 rounded-3xl shadow-2xl overflow-hidden z-10 animate-scale-up">
        {/* Header */}
        <div className="px-6 py-5 border-b border-neutral-100 dark:border-neutral-900 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-apple-blue-light dark:text-apple-blue-dark bg-apple-blue-light/10 dark:bg-apple-blue-dark/10 px-2.5 py-0.5 rounded-full">
                {subjectName}
              </span>
              {analysis && (
                <span className="text-xs text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
                  单科分值: {analysis.subject_score}分 | 班排: {analysis.class_rank} | 级排: {analysis.grade_rank}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold tracking-tight text-apple-text-lightPrimary dark:text-apple-text-darkPrimary mt-1">
              学科多维诊断分析
            </h2>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full border border-neutral-100 dark:border-neutral-800 text-apple-text-lightSecondary dark:text-apple-text-darkSecondary hover:bg-neutral-50 dark:hover:bg-neutral-900 apple-transition focus:outline-none"
          >
            <X size={18} className="stroke-[1.5]" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 py-2 border-b border-neutral-100 dark:border-neutral-900 bg-neutral-50/50 dark:bg-neutral-900/10 flex items-center gap-6 flex-shrink-0">
          <button
            onClick={() => setActiveTab('detail')}
            className={`py-2 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 focus:outline-none ${
              activeTab === 'detail'
                ? 'border-apple-text-lightPrimary dark:border-apple-text-darkPrimary text-apple-text-lightPrimary dark:text-apple-text-darkPrimary'
                : 'border-transparent text-apple-text-lightSecondary dark:text-apple-text-darkSecondary hover:text-apple-text-lightPrimary dark:hover:text-apple-text-darkPrimary'
            }`}
          >
            <CheckSquare size={14} />
            得分明细
          </button>
          <button
            onClick={() => setActiveTab('sheet')}
            className={`py-2 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 focus:outline-none ${
              activeTab === 'sheet'
                ? 'border-apple-text-lightPrimary dark:border-apple-text-darkPrimary text-apple-text-lightPrimary dark:text-apple-text-darkPrimary'
                : 'border-transparent text-apple-text-lightSecondary dark:text-apple-text-darkSecondary hover:text-apple-text-lightPrimary dark:hover:text-apple-text-darkPrimary'
            }`}
          >
            <FileText size={14} />
            答题卡原件
          </button>
        </div>

        {/* Modal Content Box */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0 bg-white dark:bg-apple-bg-darkSec">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-400">
              <Loader2 className="animate-spin mb-3 w-6 h-6 stroke-[1.5]" />
              <span className="text-xs">加载学科明细中...</span>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-red-500">
              <span className="text-sm font-semibold mb-2">出错了</span>
              <p className="text-xs text-neutral-500 max-w-md">{error}</p>
            </div>
          ) : activeTab === 'detail' ? (
            /* Tab 1: 得分明细 */
            <div className="space-y-6 animate-fade-in">
              {analysis && analysis.questions && analysis.questions.length > 0 ? (
                <div className="border border-neutral-100 dark:border-neutral-900 rounded-2xl overflow-hidden bg-white dark:bg-neutral-900/10">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="bg-neutral-50/50 dark:bg-neutral-900/30 border-b border-neutral-100 dark:border-neutral-900">
                          <th className="px-5 py-3.5 font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary w-[12%]">
                            题号
                          </th>
                          <th className="px-5 py-3.5 font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary w-[28%]">
                            题型/题目
                          </th>
                          <th className="px-5 py-3.5 font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary w-[15%] text-right">
                            满分
                          </th>
                          <th className="px-5 py-3.5 font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary w-[15%] text-right">
                            个人得分
                          </th>
                          <th className="px-5 py-3.5 font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary w-[15%]">
                            班级得分率
                          </th>
                          <th className="px-5 py-3.5 font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary w-[15%]">
                            年级得分率
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
                        {analysis.questions.map((q) => {
                          const isWrong = parseFloat(q.score) < parseFloat(q.full_score);
                          return (
                            <tr
                              key={q.bh}
                              className="hover:bg-neutral-50/30 dark:hover:bg-neutral-900/10 apple-transition"
                            >
                              <td className="px-5 py-3.5 font-bold font-mono text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
                                {q.bh}
                              </td>
                              <td className="px-5 py-3.5 font-medium text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
                                {q.name}
                              </td>
                              <td className="px-5 py-3.5 font-mono text-right text-neutral-500 dark:text-neutral-400">
                                {q.full_score}
                              </td>
                              <td
                                className={`px-5 py-3.5 font-bold font-mono text-right ${
                                  isWrong
                                    ? 'text-red-500 dark:text-red-400'
                                    : 'text-apple-text-lightPrimary dark:text-apple-text-darkPrimary'
                                }`}
                              >
                                {q.score}
                              </td>
                              <td className="px-5 py-3.5">{renderRatioBar(q.class_ratio)}</td>
                              <td className="px-5 py-3.5">{renderRatioBar(q.grade_ratio)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="py-20 text-center text-apple-text-lightSecondary dark:text-apple-text-darkSecondary text-xs">
                  暂无小题得分明细数据
                </div>
              )}
            </div>
          ) : (
            /* Tab 2: 答题卡原卷 */
            <div className="space-y-6 animate-fade-in">
              {sheet && sheet.image_urls && sheet.image_urls.length > 0 ? (
                <div className="space-y-6">
                  {/* Meta Info */}
                  <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-neutral-50 dark:bg-neutral-900/30 rounded-2xl border border-neutral-100 dark:border-neutral-900 text-xs">
                    {sheet.barcode && (
                      <div>
                        <span className="text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">准考证条码：</span>
                        <span className="font-mono font-bold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">{sheet.barcode}</span>
                      </div>
                    )}
                    {sheet.omr && (
                      <div className="max-w-md truncate" title={sheet.omr}>
                        <span className="text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">OMR 识别串：</span>
                        <span className="font-mono text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">{sheet.omr}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">答卷页数：</span>
                      <span className="font-mono font-bold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">{sheet.image_urls.length} 页</span>
                    </div>
                  </div>

                  {/* Scanned Pages Stack */}
                  <div className="space-y-8 max-w-2xl mx-auto">
                    {sheet.image_urls.map((url, idx) => {
                      const proxiedUrl = `/api/proxy/image?url=${encodeURIComponent(url)}`;
                      return (
                        <div
                          key={idx}
                          className="relative border border-neutral-150 dark:border-neutral-800 rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-950 p-2 shadow-sm"
                        >
                          <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-sm text-white px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase">
                            第 {idx + 1} 页
                          </div>
                          <img
                            src={proxiedUrl}
                            alt={`答题卡第 ${idx + 1} 页`}
                            className="w-full h-auto rounded-lg select-none pointer-events-none"
                            loading="lazy"
                            onError={(e) => {
                              // Fallback display if image fails to load
                              (e.target as HTMLElement).style.display = 'none';
                              const errNode = document.createElement('div');
                              errNode.className = 'w-full h-96 flex flex-col items-center justify-center text-xs text-neutral-400 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg bg-neutral-50 dark:bg-neutral-900';
                              errNode.innerHTML = '<span class="font-semibold text-red-400 mb-1">图片加载失败</span><span class="scale-90 opacity-70">请检查网络环境或重新尝试</span>';
                              (e.target as HTMLElement).parentNode?.appendChild(errNode);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="py-20 text-center text-apple-text-lightSecondary dark:text-apple-text-darkSecondary text-xs">
                  暂无答题卡扫描原卷数据
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
