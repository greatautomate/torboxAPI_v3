import { Link } from 'react-router-dom';

export function NotFoundPage({ home = '/' }: { home?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-bold text-accent-600">404</p>
      <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-gray-500">The page you are looking for does not exist.</p>
      <Link to={home} className="mt-6 inline-flex min-h-[44px] items-center rounded-lg bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700">
        Go back
      </Link>
    </div>
  );
}
