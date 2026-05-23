import type { Exam } from '../types';
import { Calendar, Award, ChevronRight } from 'lucide-react';

interface ExamListProps {
  exams: Exam[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}

export default function ExamList({ exams, selectedIdx, onSelect }: ExamListProps) {
  if (exams.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
        暂无考试记录
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {exams.map((exam, idx) => {
        const isSelected = idx === selectedIdx;
        return (
          <button
            key={idx}
            onClick={() => onSelect(idx)}
            className={`w-full text-left p-5 rounded-2xl border apple-transition apple-hover flex items-center justify-between
              ${
                isSelected
                  ? 'border-apple-text-lightPrimary dark:border-apple-text-darkPrimary bg-neutral-50 dark:bg-neutral-900/50'
                  : 'border-neutral-100 dark:border-neutral-900 bg-white dark:bg-apple-bg-darkSec hover:bg-neutral-50 dark:hover:bg-neutral-900/30'
              }
            `}
          >
            <div className="flex-1 min-w-0 pr-4">
              <h3 className="font-semibold text-base text-apple-text-lightPrimary dark:text-apple-text-darkPrimary truncate">
                {exam.name}
              </h3>
              <div className="flex items-center gap-3 text-xs text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mt-1.5 flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar size={12} className="stroke-[1.5]" />
                  {exam.date || '未知日期'}
                </span>
                <span className="text-neutral-300 dark:text-neutral-800">•</span>
                <span className="truncate max-w-xs">{exam.subjects}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 shrink-0 text-right">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block">
                  班级 / 年级排名
                </span>
                <span className="text-sm font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary flex items-center gap-1 justify-end">
                  <Award size={12} className="stroke-[1.5] text-neutral-400" />
                  {exam.class_rank || '-'} <span className="text-neutral-300 dark:text-neutral-700">/</span> {exam.grade_rank || '-'}
                </span>
              </div>
              <ChevronRight size={16} className={`text-neutral-300 dark:text-neutral-700 apple-transition ${isSelected ? 'translate-x-1' : ''}`} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
