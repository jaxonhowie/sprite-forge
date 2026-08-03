import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon from './ui/Icon';

interface PageShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional back link rendered above the title, e.g. { to: '/video', label: '返回上传' } */
  back?: { to: string; label: string };
  align?: 'left' | 'center';
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export default function PageShell({
  title,
  description,
  actions,
  back,
  align = 'left',
  children,
  className = '',
  contentClassName = '',
}: PageShellProps) {
  const centered = align === 'center';

  return (
    <section className={`animate-fade-in space-y-6 ${className}`}>
      <div className={centered ? 'mx-auto max-w-3xl text-center' : ''}>
        {back && (
          <Link
            to={back.to}
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-gray-500 no-underline transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <Icon name="arrow-left" size={14} />
            {back.label}
          </Link>
        )}
        <div
          className={
            centered
              ? ''
              : 'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'
          }
        >
          <div className={centered ? '' : 'min-w-0'}>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 sm:text-3xl">
              {title}
            </h1>
            {description && (
              <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className={centered ? 'mt-5 flex justify-center' : 'flex shrink-0 items-center gap-2'}>
              {actions}
            </div>
          )}
        </div>
      </div>

      <div className={contentClassName}>{children}</div>
    </section>
  );
}
