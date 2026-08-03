import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Upload from './pages/Upload';
import Capture from './pages/Capture';
import Frames from './pages/Frames';
import Process from './pages/Process';
import Result from './pages/Result';
import ImageUpload from './pages/ImageUpload';
import ImageSegments from './pages/ImageSegments';
import ImageResult from './pages/ImageResult';
import ImageTools from './pages/ImageTools';
import MultiVideoCompose from './pages/MultiVideoCompose';

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/video" element={<Upload />} />
        <Route path="/capture/:videoId" element={<Capture />} />
        <Route path="/frames/:videoId" element={<Frames />} />
        <Route path="/process/:videoId" element={<Process />} />
        <Route path="/result/:jobId" element={<Result />} />
        <Route path="/image" element={<ImageUpload />} />
        <Route path="/image/segments" element={<ImageSegments />} />
        <Route path="/image/result/:jobId" element={<ImageResult />} />
        <Route path="/image-tools" element={<ImageTools />} />
        <Route path="/multi-video" element={<MultiVideoCompose />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
