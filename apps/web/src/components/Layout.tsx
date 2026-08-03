import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 lg:py-10">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
