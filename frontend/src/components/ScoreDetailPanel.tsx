import type { ScoreDetail } from '../types';
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight } from 'lucide-react';

interface ScoreDetailPanelProps {
  data: ScoreDetail;
  onSelectSubject?: (subjectCode: string, subjectName: string) => void;
}

export default function ScoreDetailPanel({ data, onSelectSubject }: ScoreDetailPanelProps) {
  const { summary, subjects, strengths, weaknesses, changes, classmates } = data;

  // Stat Card renderer
  const renderStatCard = (label: string, value: string | undefined, subtext?: string) => {
    if (!value) return null;
    return (
      <div className="bg-neutral-50 dark:bg-neutral-900/30 p-5 rounded-2xl border border-neutral-100 dark:border-neutral-900 flex flex-col justify-between apple-transition hover:border-neutral-200 dark:hover:border-neutral-800">
        <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-1">
          {label}
        </span>
        <div>
          <span className="text-2xl font-bold tracking-tight text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
            {value}
          </span>
          {subtext && (
            <span className="text-[10px] text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mt-0.5">
              {subtext}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full space-y-8 animate-fade-in">
      {/* Title */}
      <div className="border-b border-neutral-100 dark:border-neutral-900 pb-4">
        <h3 className="text-xl font-semibold tracking-tight text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
          {data.exam_name}
        </h3>
        <p className="text-xs text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mt-1">
          详细成绩报告
        </p>
      </div>

      {/* Summary Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {renderStatCard('总分', summary.total_score, '满分分值因考试而异')}
        {renderStatCard('班级排名', summary.class_rank, `班级总人数 ${summary.total_students} 人`)}
        {renderStatCard('年级排名', summary.grade_rank, '全校相同年级排名')}
        {renderStatCard('班级平均', summary.class_avg, '班级平均成绩')}
        {renderStatCard('班级最高', summary.class_max, '班级最高分')}
        {renderStatCard('班级最低', summary.class_min, '班级最低分')}
      </div>

      {/* Strengths, Weaknesses and Trends */}
      {(strengths || weaknesses || (changes && changes.length > 0)) && (
        <div className="p-6 rounded-2xl bg-neutral-50 dark:bg-neutral-900/10 border border-neutral-100 dark:border-neutral-900 space-y-4">
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            {strengths && (
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-1">
                  优势科目
                </span>
                <div className="flex gap-1.5 flex-wrap">
                  {strengths.split(',').map((s) => (
                    <span key={s} className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 px-2.5 py-0.5 rounded-full">
                      {s.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {weaknesses && (
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-1">
                  需提升科目
                </span>
                <div className="flex gap-1.5 flex-wrap">
                  {weaknesses.split(',').map((w) => (
                    <span key={w} className="text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20 px-2.5 py-0.5 rounded-full">
                      {w.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {changes && changes.length > 0 && (
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-2">
                较上次考试变化
              </span>
              <div className="flex flex-wrap gap-2">
                {changes.map((ch) => {
                  const isUp = ch.direction === 'up';
                  const isDown = ch.direction === 'down';
                  const diffVal = `${(ch.diff * 100).toFixed(1)}%`;
                  
                  return (
                    <span
                      key={ch.subject}
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border
                        ${
                          isUp
                            ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-100/50 dark:border-emerald-900/20'
                            : isDown
                            ? 'text-red-600 dark:text-red-400 bg-red-50/30 dark:bg-red-950/10 border-red-100/50 dark:border-red-900/20'
                            : 'text-neutral-500 dark:text-neutral-400 bg-neutral-100/50 dark:bg-neutral-900/50 border-neutral-200/50 dark:border-neutral-800/30'
                        }
                      `}
                    >
                      {ch.subject}
                      {isUp ? (
                        <ArrowUpRight size={10} className="stroke-[2.5]" />
                      ) : isDown ? (
                        <ArrowDownRight size={10} className="stroke-[2.5]" />
                      ) : (
                        <Minus size={10} className="stroke-[2.5]" />
                      )}
                      {isUp ? '+' : ''}{diffVal}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subject Scores Table */}
      {subjects && subjects.length > 0 && (
        <div className="w-full overflow-hidden border border-neutral-100 dark:border-neutral-900 rounded-2xl bg-white dark:bg-apple-bg-darkSec">
          <div className="px-6 py-4 bg-neutral-50/30 dark:bg-neutral-900/10 border-b border-neutral-100 dark:border-neutral-900 flex justify-between items-center">
            <span className="text-xs font-semibold text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
              单科成绩明细 (点击学科行可查看小题分析与答题原卷)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50 dark:bg-neutral-900/20 border-b border-neutral-100 dark:border-neutral-900">
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
                    科目
                  </th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
                    单科得分
                  </th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
                    班级排名
                  </th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
                    年级排名
                  </th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
                    班级均分
                  </th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
                    年级均分
                  </th>
                  <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary text-right">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
                {subjects.map((subj) => {
                  const isClickable = !!subj.code;
                  return (
                    <tr
                      key={subj.name}
                      onClick={() => {
                        if (isClickable && onSelectSubject) {
                          onSelectSubject(subj.code, subj.name);
                        }
                      }}
                      className={`apple-transition ${
                        isClickable
                          ? 'cursor-pointer hover:bg-neutral-50/80 dark:hover:bg-neutral-900/30'
                          : ''
                      }`}
                    >
                      <td className="px-6 py-4 font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
                        {subj.name}
                      </td>
                      <td className="px-6 py-4 font-medium text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
                        {subj.score || '-'}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 dark:text-neutral-400">
                        {subj.class_rank || '-'}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 dark:text-neutral-400">
                        {subj.grade_rank || '-'}
                      </td>
                      <td className="px-6 py-4 text-neutral-500 dark:text-neutral-500">
                        {subj.class_avg || '-'}
                      </td>
                      <td className="px-6 py-4 text-neutral-500 dark:text-neutral-500">
                        {subj.grade_avg || '-'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {isClickable ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-apple-blue-light dark:text-apple-blue-dark">
                            分析
                            <ChevronRight size={12} className="stroke-[2.5]" />
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-300 dark:text-neutral-700">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Classmates Rank Leaderboard */}
      {classmates && classmates.length > 0 && (
        <div className="p-6 rounded-2xl border border-neutral-100 dark:border-neutral-900 bg-white dark:bg-apple-bg-darkSec space-y-4">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block">
              班级成绩分布速览
            </span>
            <p className="text-xs text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mt-0.5">
              班级内总分前 {classmates.length} 名成绩参考
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {classmates.map((c, index) => (
              <div
                key={index}
                className="px-4 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-100 dark:border-neutral-900 flex items-center gap-2.5"
              >
                <span className="text-xs font-semibold text-apple-text-lightSecondary dark:text-apple-text-darkSecondary bg-neutral-200/50 dark:bg-neutral-800/60 w-5 h-5 rounded-full flex items-center justify-center">
                  {index + 1}
                </span>
                <span className="text-xs font-medium text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
                  {c.name}
                </span>
                <span className="text-xs font-bold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
                  {c.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
