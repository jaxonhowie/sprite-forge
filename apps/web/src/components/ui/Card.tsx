import type { ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export default function Card({
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: CardProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <section
      className={`rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            )}
            {description && (
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
