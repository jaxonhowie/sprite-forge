import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearRuntimeData } from '../api/client';
import { clearAllImageWorkflowState } from '../utils/imageWorkflowState';
import { clearAllWorkflowState } from '../utils/workflowState';

function FilmIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="4.5" width="14" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 4.5v15M15 4.5v15" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 8h4M5 12h4M5 16h4M15 8h4M15 12h4M15 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function AlbumIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 14l2.5-2.5a1 1 0 0 1 1.4 0L14 13.6l1.5-1.5a1 1 0 0 1 1.4 0L20 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" />
      <path d="M7 3.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="10" y="11" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 16h3M14 8h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const entryCards = [
  {
    title: '视频处理',
    description: '上传 MP4 或 WebM，自动截帧、去背景并导出精灵表。',
    cta: '进入视频流程',
    to: '/video',
    accent: 'from-blue-500/20 to-cyan-500/10',
    border: 'border-blue-500/30',
    icon: 'film',
  },
  {
    title: '多视频拼帧',
    description: '上传多个视频，截取关键帧后统一排序、删除并导出一个精灵表。',
    cta: '进入拼帧流程',
    to: '/multi-video',
    accent: 'from-indigo-500/20 to-sky-500/10',
    border: 'border-indigo-500/30',
    icon: 'stack',
  },
  {
    title: '图片切图',
    description: '上传白底素材图，自动识别小块、逐块去背景并导出结果。',
    cta: '进入切图流程',
    to: '/image',
    accent: 'from-green-500/20 to-emerald-500/10',
    border: 'border-green-500/30',
    icon: 'album',
  },
];

export default function Home() {
  const navigate = useNavigate();

  async function handleEntryClick(event: MouseEvent<HTMLAnchorElement>) {
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
    <div className="mx-auto max-w-5xl">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Sprite Forge</h1>
        <p className="mt-3 text-sm text-gray-500">选择一条工作流开始处理素材</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {entryCards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            onClick={(event) => void handleEntryClick(event)}
            className={`rounded-lg border ${card.border} bg-gradient-to-br ${card.accent} p-6 no-underline transition-transform hover:-translate-y-0.5 hover:border-gray-400`}
          >
            <div className="flex h-full flex-col">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded bg-gray-900 text-gray-100">
                {card.icon === 'film' ? <FilmIcon /> : card.icon === 'stack' ? <StackIcon /> : <AlbumIcon />}
              </div>
              <h2 className="text-xl font-semibold text-gray-900">{card.title}</h2>
              <p className="mt-3 flex-1 text-sm leading-6 text-gray-600">{card.description}</p>
              <div className="mt-6 text-sm font-medium text-gray-900">{card.cta} →</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
