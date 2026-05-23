interface StepIndicatorProps {
  currentStep: number;
}

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  const steps = [
    { number: 1, label: '选校' },
    { number: 2, label: '登录' },
    { number: 3, label: '验证码' },
    { number: 4, label: '成绩' },
  ];

  return (
    <div className="flex justify-center items-center w-full max-w-lg mx-auto py-8">
      {steps.map((step, idx) => {
        const isActive = step.number === currentStep;
        const isDone = step.number < currentStep;

        return (
          <div key={step.number} className="flex items-center flex-1 last:flex-none">
            {/* Step circle & label */}
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold border apple-transition
                  ${
                    isActive
                      ? 'border-apple-text-lightPrimary dark:border-apple-text-darkPrimary bg-apple-text-lightPrimary dark:bg-apple-text-darkPrimary text-apple-bg-light dark:text-apple-bg-dark'
                      : isDone
                      ? 'border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400'
                      : 'border-neutral-200 dark:border-neutral-800 bg-transparent text-neutral-300 dark:text-neutral-700'
                  }
                `}
              >
                {step.number}
              </div>
              <span
                className={`text-xs font-medium tracking-tight hidden sm:inline apple-transition
                  ${
                    isActive
                      ? 'text-apple-text-lightPrimary dark:text-apple-text-darkPrimary'
                      : 'text-neutral-400 dark:text-neutral-600'
                  }
                `}
              >
                {step.label}
              </span>
            </div>

            {/* Connecting line */}
            {idx < steps.length - 1 && (
              <div className="flex-1 mx-4 h-[1px] bg-neutral-200 dark:bg-neutral-800 relative">
                <div
                  className="absolute left-0 top-0 h-full bg-apple-text-lightPrimary dark:bg-apple-text-darkPrimary apple-transition"
                  style={{ width: isDone ? '100%' : '0%' }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
