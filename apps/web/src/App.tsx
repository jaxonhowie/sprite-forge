import { Routes, Route, Navigate } from 'react-router-dom';
import Workflow from './pages/Workflow';

function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 px-4 py-4">
        <div className="mx-auto w-full max-w-[1180px]">
          <h1 className="text-2xl font-bold">Sprite Forge</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] px-4 py-6">
        <Routes>
          <Route path="/" element={<Workflow />} />
          <Route path="/capture/:videoId" element={<Navigate to="/" replace />} />
          <Route path="/frames/:videoId" element={<Navigate to="/" replace />} />
          <Route path="/process/:videoId" element={<Navigate to="/" replace />} />
          <Route path="/result/:jobId" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
