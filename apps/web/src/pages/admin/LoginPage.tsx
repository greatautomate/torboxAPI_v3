import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { qk } from '../../lib/queries';
import { Button, Input } from '../../components/ui';

export function LoginPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · TorBox Gateway';
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.login({ email, password, totp: needTotp ? totp : undefined });
      qc.setQueryData(qk.me, r);
      const next = sp.get('next');
      nav(next && next.startsWith('/admin') ? next : '/admin', { replace: true });
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === 'TOTP_REQUIRED') {
        if (needTotp && totp) setError('Invalid authenticator code.');
        setNeedTotp(true);
      } else setError(ae.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-10 dark:bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-600 text-white" aria-hidden>
            <svg viewBox="0 0 32 32" className="h-7 w-7">
              <path d="M9 11h14M9 16h14M9 21h9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
            </svg>
          </span>
          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-gray-100">TorBox Gateway admin</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to manage keys, policies and traffic.</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6" aria-describedby={error ? 'login-error' : undefined}>
          {!needTotp ? (
            <>
              <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <ShieldCheck className="h-4 w-4 text-accent-600" aria-hidden />
                Two-factor authentication is enabled for <span className="font-medium">{email}</span>.
              </div>
              <Input label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" value={totp} onChange={(e) => setTotp(e.target.value)} required autoFocus />
            </div>
          )}
          {error && (
            <p id="login-error" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={busy}>
            {needTotp ? 'Verify' : 'Sign in'}
          </Button>
          {needTotp && (
            <button type="button" className="w-full text-center text-sm text-gray-500 hover:underline" onClick={() => (setNeedTotp(false), setTotp(''), setError(null))}>
              Back
            </button>
          )}
        </form>
        <p className="mt-6 text-center text-xs text-gray-500">
          <a href="/" className="hover:underline">
            ← Back to homepage
          </a>
        </p>
      </div>
    </div>
  );
}
