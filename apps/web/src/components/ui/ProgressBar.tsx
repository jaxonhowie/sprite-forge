interface ProgressBarProps {
  /** 0 - 1 */
  value: number;
  tone?: 'brand' | 'green' | 'red';
  className?: string;
}

const toneClasses = {
  brand: 'bg-brand-600 dark:bg-brand-500',
  green: 'bg-green-600 dark:bg-green-500',
  red: 'bg-red-600 dark:bg-red-500',
} as const;

export default function ProgressBar({ value, tone = 'brand', className = '' }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));

  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800 ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all duration-300 ${toneClasses[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
