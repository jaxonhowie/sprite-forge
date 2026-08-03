import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clearAllImageWorkflowState } from '../utils/imageWorkflowState';
import { clearAllWorkflowState } from '../utils/workflowState';
import Icon from './ui/Icon';
import ThemeToggle from './ThemeToggle';

const navItems = [
  { label: '视频处理', path: '/video', prefixes: ['/video', '/capture', '/frames', '/process', '/result'] },
  { label: '多视频拼帧', path: '/multi-video', prefixes: ['/multi-video'] },
  { label: '提取要素', path: '/image', prefixes: ['/image'] },
  { label: '图片处理', path: '/image-tools', prefixes: ['/image-tools'] },
];

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  function handleFeatureEntry(path: string) {
    clearAllWorkflowState();
    clearAllImageWorkflowState();
    navigate(path);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white shadow-sm">
            <Icon name="sparkles" size={15} />
          </span>
          <span className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Sprite Forge
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const active = item.prefixes.some((prefix) => pathname.startsWith(prefix));
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => handleFeatureEntry(item.path)}
                className={`rounded-md px-2.5 py-1.5 text-sm transition-colors sm:px-3 ${
                  active
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <span className="mx-1.5 h-5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
