import type { ReactNode } from 'react';

interface PageShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  align?: 'left' | 'center';
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export default function PageShell({
  title,
  description,
  actions,
  align = 'left',
  children,
  className = '',
  contentClassName = '',
}: PageShellProps) {
  const centered = align === 'center';

  return (
    <section className={`space-y-8 ${className}`}>
      <div
        className={
          centered
            ? 'mx-auto max-w-3xl text-center'
            : 'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'
        }
      >
        <div className={centered ? '' : 'min-w-0'}>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className={centered ? 'mt-6 flex justify-center' : 'shrink-0'}>
            {actions}
          </div>
        )}
      </div>

      <div className={contentClassName}>{children}</div>
    </section>
  );
}
