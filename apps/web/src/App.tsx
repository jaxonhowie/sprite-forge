import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import Upload from './pages/Upload';
import Capture from './pages/Capture';
import Frames from './pages/Frames';
import Process from './pages/Process';
import Result from './pages/Result';
import ImageUpload from './pages/ImageUpload';
import ImageSegments from './pages/ImageSegments';
import ImageResult from './pages/ImageResult';

function App() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-gray-900 no-underline">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
            Sprite Forge
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium text-gray-600">
            <Link className="transition-colors hover:text-gray-900" to="/">首页</Link>
            <Link className="transition-colors hover:text-gray-900" to="/video">视频处理</Link>
            <Link className="transition-colors hover:text-gray-900" to="/image">图片切图</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/video" element={<Upload />} />
          <Route path="/capture/:videoId" element={<Capture />} />
          <Route path="/frames/:videoId" element={<Frames />} />
          <Route path="/process/:videoId" element={<Process />} />
          <Route path="/result/:jobId" element={<Result />} />
          <Route path="/image" element={<ImageUpload />} />
          <Route path="/image/segments/:imageId" element={<ImageSegments />} />
          <Route path="/image/result/:jobId" element={<ImageResult />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="border-t border-gray-100 py-6 text-center text-sm text-gray-400">
        &copy; 2026 Sprite Forge
      </footer>
    </div>
  );
}

export default App;
