import { useTheme } from '../contexts/ThemeContext';
import Icon, { type IconName } from './ui/Icon';

const labels: Record<string, string> = {
  light: '浅色模式',
  dark: '深色模式',
  system: '跟随系统',
};

const icons: Record<string, IconName> = {
  light: 'sun',
  dark: 'moon',
  system: 'monitor',
};

export default function ThemeToggle() {
  const { theme, cycle } = useTheme();

  return (
    <button
      type="button"
      onClick={cycle}
      title={labels[theme]}
      aria-label={labels[theme]}
      className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      <Icon name={icons[theme]} size={17} />
    </button>
  );
}
