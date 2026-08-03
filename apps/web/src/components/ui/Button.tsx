import type { ButtonHTMLAttributes } from 'react';
import Icon from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSoft';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const baseClass =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-950';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 dark:bg-brand-500 dark:hover:bg-brand-400',
  secondary:
    'border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
  ghost:
    'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800',
  dangerSoft:
    'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${baseClass} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Icon name="loader" size={16} className="animate-spin" />}
      {children}
    </button>
  );
}
