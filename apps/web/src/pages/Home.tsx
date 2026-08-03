import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearRuntimeData } from '../api/client';
import PageShell from '../components/PageShell';
import Icon, { type IconName } from '../components/ui/Icon';
import { clearAllImageWorkflowState } from '../utils/imageWorkflowState';
import { clearAllWorkflowState } from '../utils/workflowState';

interface EntryCard {
  title: string;
  description: string;
  cta: string;
  to: string;
  icon: IconName;
  iconClass: string;
}

const entryCards: EntryCard[] = [
  {
    title: '视频处理',
    description: '上传 MP4 或 WebM，自动截帧、去背景并导出精灵表。',
    cta: '进入视频流程',
    to: '/video',
    icon: 'film',
    iconClass: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400',
  },
  {
    title: '多视频拼帧',
    description: '上传多个视频，截取关键帧后统一排序、删除并导出一个精灵表。',
    cta: '进入拼帧流程',
    to: '/multi-video',
    icon: 'layers',
    iconClass: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  },
  {
    title: '提取要素',
    description: '上传白底素材图，自动识别小块、逐块去背景并导出结果。',
    cta: '进入提取流程',
    to: '/image',
    icon: 'images',
    iconClass: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
  },
  {
    title: '图片处理',
    description: '对单张图片去除背景或框选去除水印，即传即得。',
    cta: '进入图片处理',
    to: '/image-tools',
    icon: 'sliders',
    iconClass: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  },
];

export default function Home() {
  const navigate = useNavigate();

  async function handleEntryClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let modifier-clicks open a new tab without touching current session state.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = event.currentTarget.getAttribute('href');
    if (!href) return;

    try {
      await clearRuntimeData();
    } catch {
      // Keep entry navigation usable even if cleanup fails.
    }

    clearAllWorkflowState();
    clearAllImageWorkflowState();
    navigate(href);
  }

  return (
    <PageShell
      title="Sprite Forge"
      description="选择一条工作流开始处理素材"
      align="center"
      contentClassName="space-y-8"
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {entryCards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            onClick={(event) => void handleEntryClick(event)}
            className="group rounded-xl border border-gray-200 bg-white p-6 no-underline shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-700"
          >
            <div className="flex h-full flex-col">
              <span
                className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg ${card.iconClass}`}
              >
                <Icon name={card.icon} size={22} />
              </span>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{card.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                {card.description}
              </p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 dark:text-brand-400">
                {card.cta}
                <Icon name="arrow-right" size={16} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
      <p className="text-center text-xs text-gray-400 dark:text-gray-500">
        所有处理均在本地完成 &middot; 支持 Cocos / Unity / Godot / GIF 等六种导出格式
      </p>
    </PageShell>
  );
}
