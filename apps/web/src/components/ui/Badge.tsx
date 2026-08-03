import type { ReactNode } from 'react';

export type BadgeTone = 'gray' | 'brand' | 'green' | 'red' | 'amber' | 'blue';

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<BadgeTone, string> = {
  gray: 'bg-gray-100 text-gray-600 ring-gray-500/10 dark:bg-gray-400/10 dark:text-gray-400 dark:ring-gray-400/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-400/10 dark:text-brand-300 dark:ring-brand-400/30',
  green: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:ring-green-400/20',
  red: 'bg-red-50 text-red-700 ring-red-600/10 dark:bg-red-400/10 dark:text-red-400 dark:ring-red-400/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-700/10 dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/20',
};

const dotClasses: Record<BadgeTone, string> = {
  gray: 'bg-gray-400',
  brand: 'bg-brand-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
};

export default function Badge({ tone = 'gray', dot = false, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClasses[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />}
      {children}
    </span>
  );
}
