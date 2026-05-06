import { Routes, Route, Navigate } from 'react-router-dom';
import Upload from './pages/Upload';
import Capture from './pages/Capture';
import Frames from './pages/Frames';
import Process from './pages/Process';
import Result from './pages/Result';

function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 p-4">
        <h1 className="text-2xl font-bold">Sprite Forge</h1>
      </header>
      <main className="container mx-auto p-4">
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/capture/:videoId" element={<Capture />} />
          <Route path="/frames/:videoId" element={<Frames />} />
          <Route path="/process/:videoId" element={<Process />} />
          <Route path="/result/:jobId" element={<Result />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
