export interface Organization {
  id: string;
  name: string;
}

export interface StudentInfo {
  name: string;
  id: string;
  grade: string;
  class: string;
}

export interface Exam {
  ksdm: string;
  kldm: string;
  name: string;
  date: string;
  class_rank: string;
  grade_rank: string;
  subjects: string;
  _cached?: boolean;
  _cachedData?: any;
}

export interface ExamListResponse {
  student: StudentInfo;
  school: string;
  exam_count: number;
  exams: Exam[];
}

export interface SubjectScore {
  name: string;
  code: string;
  score: string;
  class_rank: string;
  grade_rank: string;
  class_avg: string;
  grade_avg: string;
}

export interface ScoreChange {
  subject: string;
  diff: number;
  direction: 'up' | 'down' | 'flat';
}

export interface ClassmateScore {
  name: string;
  total: string;
}

export interface ScoreDetail {
  exam_name: string;
  summary: {
    total_score: string;
    class_rank: string;
    grade_rank: string;
    total_students: string;
    class_max?: string;
    class_avg?: string;
    class_min?: string;
  };
  subjects: SubjectScore[];
  strengths: string;
  weaknesses: string;
  changes: ScoreChange[];
  classmates: ClassmateScore[];
}

export interface Config {
  org_id: string;
  username: string;
  password?: string;
  tg_token?: string;
  tg_chat_id: string;
  monitor_enabled: boolean;
  monitor_interval: number;
  last_scores?: any;
}

export interface MonitorStatus {
  running: boolean;
  monitor_enabled: boolean;
  monitor_interval: number;
  last_check: string;
  next_check: string;
  last_hash: string;
  last_error: string;
  consecutive_failures: number;
  has_scores: boolean;
  last_scores: any;
}

export interface TrendExamPoint {
  exam_name: string;
  exam_date: string;
  total_score: number;
  class_rank: number;
  grade_rank: number;
  total_students: number;
  subjects: { name: string; score: number }[];
}

export interface QuestionDetail {
  bh: string;
  name: string;
  full_score: string;
  score: string;
  class_ratio: string;
  grade_ratio: string;
}

export interface SubjectAnalysisResponse {
  subject_score: string;
  class_rank: string;
  grade_rank: string;
  questions: QuestionDetail[];
}

export interface AnswerSheetResponse {
  base_url: string;
  barcode: string;
  page_count: number;
  image_urls: string[];
  omr: string;
}
