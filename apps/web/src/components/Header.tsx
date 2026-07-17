import { Link, useNavigate } from 'react-router-dom';
import { clearAllImageWorkflowState } from '../utils/imageWorkflowState';
import { clearAllWorkflowState } from '../utils/workflowState';
import ThemeToggle from './ThemeToggle';

export default function Header() {
  const navigate = useNavigate();

  function handleFeatureEntry(path: string) {
    clearAllWorkflowState();
    clearAllImageWorkflowState();
    navigate(path);
  }

  return (
    <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold text-gray-900 no-underline dark:text-gray-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
          Sprite Forge
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-gray-600 dark:text-gray-400">
          <Link className="transition-colors hover:text-gray-900 dark:hover:text-gray-100" to="/">首页</Link>
          <button type="button" onClick={() => handleFeatureEntry('/video')} className="bg-transparent p-0 transition-colors hover:text-gray-900 dark:hover:text-gray-100">
            视频处理
          </button>
          <button type="button" onClick={() => handleFeatureEntry('/multi-video')} className="bg-transparent p-0 transition-colors hover:text-gray-900 dark:hover:text-gray-100">
            多视频拼帧
          </button>
          <button type="button" onClick={() => handleFeatureEntry('/image')} className="bg-transparent p-0 transition-colors hover:text-gray-900 dark:hover:text-gray-100">
            图片切图
          </button>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
