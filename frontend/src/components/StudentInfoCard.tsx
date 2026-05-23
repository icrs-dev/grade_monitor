import type { StudentInfo } from '../types';

interface StudentInfoCardProps {
  student: StudentInfo;
  school: string;
  isCached?: boolean;
}

export default function StudentInfoCard({ student, school, isCached }: StudentInfoCardProps) {
  return (
    <div className="w-full rounded-2xl border border-neutral-100 dark:border-neutral-900 bg-white dark:bg-apple-bg-darkSec p-6 flex flex-wrap items-center justify-between gap-6 animate-fade-in">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-0.5">
            学生姓名
          </span>
          <span className="text-sm font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
            {student.name}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-0.5">
            学籍号
          </span>
          <span className="text-sm font-medium text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
            {student.id}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-0.5">
            就读学校
          </span>
          <span className="text-sm font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
            {school}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-apple-text-lightSecondary dark:text-apple-text-darkSecondary block mb-0.5">
            班级信息
          </span>
          <span className="text-sm font-medium text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
            {student.grade} / {student.class}班
          </span>
        </div>
      </div>

      {isCached && (
        <span className="text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 text-amber-600 dark:text-amber-500 animate-pulse">
          离线缓存数据
        </span>
      )}
    </div>
  );
}
