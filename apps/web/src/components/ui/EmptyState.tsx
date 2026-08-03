import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon = 'image',
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700 ${className}`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
