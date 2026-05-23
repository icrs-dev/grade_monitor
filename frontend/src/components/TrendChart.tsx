import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import type { TrendExamPoint } from '../types';
import { BarChart2, LineChart } from 'lucide-react';

interface TrendChartProps {
  data: TrendExamPoint[];
}

const IOS_COLORS = [
  '#007aff', // Blue
  '#5856d6', // Indigo
  '#af52de', // Purple
  '#ff2d55', // Pink
  '#ff3b30', // Red
  '#ff9500', // Orange
  '#ffcc00', // Yellow
  '#34c759', // Green
  '#5ac8fa', // Teal
];

export default function TrendChart({ data }: TrendChartProps) {
  const [view, setView] = useState<'total' | 'subject'>('total');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !data || data.length === 0) return;

    // Destroy existing chart instance if any to prevent leaks
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
      chartInstanceRef.current = null;
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const isDarkMode = document.documentElement.classList.contains('dark');
    
    // Label formatting: truncate long exam names
    const labels = data.map((e) => {
      const name = e.exam_name;
      return name.length > 12 ? name.slice(0, 10) + '…' : name;
    });

    // Default typography & grid styles
    const textColor = isDarkMode ? 'rgba(245, 245, 247, 0.8)' : 'rgba(29, 29, 31, 0.8)';
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const tooltipBg = isDarkMode ? 'rgba(29, 29, 31, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    const tooltipBorder = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';

    const chartConfig: any = {
      type: 'line',
      data: {
        labels,
        datasets: [],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 6,
              boxHeight: 6,
              color: textColor,
              font: {
                family: 'SF Pro Text, sans-serif',
                size: 11,
                weight: '500',
              },
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: isDarkMode ? '#ffffff' : '#1d1d1f',
            bodyColor: isDarkMode ? '#e5e5ea' : '#48484a',
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 12,
            titleFont: {
              family: 'SF Pro Text',
              size: 12,
              weight: '600',
            },
            bodyFont: {
              family: 'SF Pro Text',
              size: 12,
            },
            boxWidth: 8,
            boxHeight: 8,
            boxPadding: 4,
            usePointStyle: true,
          },
        },
        scales: {
          x: {
            grid: {
              color: gridColor,
            },
            ticks: {
              color: textColor,
              font: {
                family: 'SF Pro Text',
                size: 10,
              },
              maxRotation: 15,
            },
          },
        },
      },
    };

    if (view === 'total') {
      const scores = data.map((e) => e.total_score);
      const classRanks = data.map((e) => e.class_rank || null);
      const gradeRanks = data.map((e) => e.grade_rank || null);

      const accentBlue = isDarkMode ? '#2997ff' : '#0066cc';

      chartConfig.data.datasets = [
        {
          label: '总分',
          data: scores,
          borderColor: accentBlue,
          backgroundColor: isDarkMode ? 'rgba(41, 151, 255, 0.08)' : 'rgba(0, 102, 204, 0.04)',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: accentBlue,
          pointBorderColor: isDarkMode ? '#000000' : '#ffffff',
          pointBorderWidth: 1.5,
          tension: 0.25,
          fill: true,
          yAxisID: 'y',
        },
        {
          label: '班级排名',
          data: classRanks,
          borderColor: '#86868b',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 3.5,
          pointBackgroundColor: '#86868b',
          pointBorderColor: isDarkMode ? '#000000' : '#ffffff',
          pointBorderWidth: 1.5,
          tension: 0.25,
          fill: false,
          yAxisID: 'y1',
        },
        {
          label: '年级排名',
          data: gradeRanks,
          borderColor: '#ff9500',
          borderWidth: 1.5,
          borderDash: [3, 3],
          pointRadius: 3.5,
          pointBackgroundColor: '#ff9500',
          pointBorderColor: isDarkMode ? '#000000' : '#ffffff',
          pointBorderWidth: 1.5,
          tension: 0.25,
          fill: false,
          yAxisID: 'y1',
        },
      ];

      chartConfig.options.scales.y = {
        type: 'linear',
        position: 'left',
        grid: {
          color: gridColor,
        },
        ticks: {
          color: textColor,
          font: {
            family: 'SF Pro Text',
            size: 10,
          },
        },
        title: {
          display: true,
          text: '得分',
          color: textColor,
          font: {
            family: 'SF Pro Text',
            size: 10,
            weight: '600',
          },
        },
        min: Math.max(0, Math.min(...scores.filter(Boolean)) - 20),
      };

      chartConfig.options.scales.y1 = {
        type: 'linear',
        position: 'right',
        reverse: true, // Ranks are better when closer to 1
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          color: textColor,
          font: {
            family: 'SF Pro Text',
            size: 10,
          },
        },
        title: {
          display: true,
          text: '名次',
          color: textColor,
          font: {
            family: 'SF Pro Text',
            size: 10,
            weight: '600',
          },
        },
      };

      // Add student count info in tooltip callback
      chartConfig.options.plugins.tooltip.callbacks = {
        label(context: any) {
          const val = context.raw;
          if (context.dataset.label === '总分') return `总分: ${val} 分`;
          return `${context.dataset.label}: 第 ${val || '-'} 名`;
        },
        afterBody(items: any) {
          const idx = items[0]?.dataIndex;
          if (idx === undefined || !data[idx]) return '';
          const pt = data[idx];
          return pt.total_students ? `班级人数: ${pt.total_students} 人` : '';
        },
      };
    } else {
      // Subject scores mode
      const subjectMap: { [name: string]: (number | null)[] } = {};
      const examCount = data.length;

      data.forEach((exam, idx) => {
        (exam.subjects || []).forEach((subj) => {
          if (!subjectMap[subj.name]) {
            subjectMap[subj.name] = new Array(examCount).fill(null);
          }
          subjectMap[subj.name][idx] = subj.score || null;
        });
      });

      chartConfig.data.datasets = Object.entries(subjectMap).map(([name, scores], idx) => {
        const color = IOS_COLORS[idx % IOS_COLORS.length];
        return {
          label: name,
          data: scores,
          borderColor: color,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: color,
          pointBorderColor: isDarkMode ? '#000000' : '#ffffff',
          pointBorderWidth: 1.5,
          tension: 0.25,
          spanGaps: false,
        };
      });

      chartConfig.options.scales.y = {
        grid: {
          color: gridColor,
        },
        ticks: {
          color: textColor,
          font: {
            family: 'SF Pro Text',
            size: 10,
          },
        },
        title: {
          display: true,
          text: '单科得分',
          color: textColor,
          font: {
            family: 'SF Pro Text',
            size: 10,
            weight: '600',
          },
        },
      };

      chartConfig.options.plugins.tooltip.callbacks = {
        label(context: any) {
          return `${context.dataset.label}: ${context.raw || '-'} 分`;
        },
      };
    }

    // Initialize Chart.js
    chartInstanceRef.current = new Chart(ctx, chartConfig);

    // Explicit cleanup function inside useEffect to destroy Chart.js instance
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [data, view]);

  return (
    <div className="bg-white dark:bg-apple-bg-darkSec border border-neutral-100 dark:border-neutral-900 rounded-2xl p-6 space-y-6 animate-fade-in">
      {/* Switcher & Header */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
            成绩与排名走势
          </h3>
          <p className="text-xs text-apple-text-lightSecondary dark:text-apple-text-darkSecondary mt-0.5">
            可视化各阶段的学情起伏
          </p>
        </div>

        <div className="flex rounded-full bg-neutral-100 dark:bg-neutral-900 p-0.5 border border-neutral-100 dark:border-neutral-900/50">
          <button
            onClick={() => setView('total')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold apple-transition
              ${
                view === 'total'
                  ? 'bg-white dark:bg-apple-bg-darkSec text-apple-text-lightPrimary dark:text-apple-text-darkPrimary shadow-sm'
                  : 'text-apple-text-lightSecondary dark:text-apple-text-darkSecondary hover:opacity-80'
              }
            `}
          >
            <LineChart size={12} className="stroke-[2]" />
            总分与排名
          </button>
          <button
            onClick={() => setView('subject')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold apple-transition
              ${
                view === 'subject'
                  ? 'bg-white dark:bg-apple-bg-darkSec text-apple-text-lightPrimary dark:text-apple-text-darkPrimary shadow-sm'
                  : 'text-apple-text-lightSecondary dark:text-apple-text-darkSecondary hover:opacity-80'
              }
            `}
          >
            <BarChart2 size={12} className="stroke-[2]" />
            各科得分
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="relative h-[320px] w-full">
        <canvas ref={canvasRef} />
      </div>

      {/* Dynamic Hint */}
      <p className="text-center text-[10px] text-apple-text-lightSecondary dark:text-apple-text-darkSecondary">
        {view === 'total'
          ? '蓝色实线为总分，虚线为班级/年级名次（排名越靠上表示名次越好）'
          : '只显示该考试包含的科目，缺失科目的考次将保持断开不连线'}
      </p>
    </div>
  );
}
