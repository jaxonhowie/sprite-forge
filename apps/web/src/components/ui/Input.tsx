import type { InputHTMLAttributes } from 'react';

export const inputClass =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-900';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export default function Input({ className = '', ...rest }: InputProps) {
  return <input className={`${inputClass} ${className}`} {...rest} />;
}
