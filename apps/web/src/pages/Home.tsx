import { Link } from 'react-router-dom';

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

const entryCards = [
  {
    title: '视频处理',
    description: '上传 MP4 或 WebM，自动截帧、去背景并导出精灵表。',
    cta: '进入视频流程',
    to: '/video',
    accent: 'from-blue-500/20 to-cyan-500/10',
    border: 'border-blue-500/30',
  },
  {
    title: '图片切图',
    description: '上传白底素材图，自动识别小块、逐块去背景并导出结果。',
    cta: '进入切图流程',
    to: '/image',
    accent: 'from-green-500/20 to-emerald-500/10',
    border: 'border-green-500/30',
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Sprite Forge</h1>
        <p className="mt-3 text-sm text-gray-500">选择一条工作流开始处理素材</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {entryCards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className={`rounded-lg border ${card.border} bg-gradient-to-br ${card.accent} p-6 no-underline transition-transform hover:-translate-y-0.5 hover:border-gray-400`}
          >
            <div className="flex h-full flex-col">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded bg-gray-900 text-gray-100">
                {card.title === '视频处理' ? <FilmIcon /> : <AlbumIcon />}
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
