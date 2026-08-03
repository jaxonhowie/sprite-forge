import Icon from './Icon';

interface StepsProps {
  steps: string[];
  /** 0-based index of the current step */
  current: number;
  className?: string;
}

export default function Steps({ steps, current, className = '' }: StepsProps) {
  return (
    <ol className={`flex items-center ${className}`}>
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;

        const circleClass = done
          ? 'bg-brand-600 text-white'
          : active
            ? 'border-2 border-brand-600 bg-white text-brand-700 dark:bg-gray-900 dark:text-brand-400'
            : 'border border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-500';

        const labelClass = active
          ? 'font-medium text-gray-900 dark:text-gray-100'
          : done
            ? 'text-gray-600 dark:text-gray-300'
            : 'text-gray-400 dark:text-gray-500';

        return (
          <li key={label} className={`flex items-center gap-2 ${index < steps.length - 1 ? 'min-w-0 flex-1' : ''}`}>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${circleClass}`}
            >
              {done ? <Icon name="check" size={13} /> : index + 1}
            </span>
            <span className={`whitespace-nowrap text-xs ${labelClass}`}>{label}</span>
            {index < steps.length - 1 && (
              <span
                className={`mx-3 h-px min-w-4 flex-1 ${done ? 'bg-brand-600 dark:bg-brand-500' : 'bg-gray-200 dark:bg-gray-700'}`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
