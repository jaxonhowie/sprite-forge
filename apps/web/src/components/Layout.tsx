import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 lg:py-12">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
