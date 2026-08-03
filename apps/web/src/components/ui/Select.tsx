import type { SelectHTMLAttributes } from 'react';
import Icon from './Icon';

export const selectClass =
  'block w-full appearance-none rounded-md border border-gray-300 bg-white py-2 pl-3 pr-9 text-sm text-gray-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:disabled:bg-gray-900';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

export default function Select({ className = '', wrapperClassName = '', children, ...rest }: SelectProps) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select className={`${selectClass} ${className}`} {...rest}>
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
      />
    </div>
  );
}
