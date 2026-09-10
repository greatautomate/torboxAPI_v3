import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { qk, useApiMutation, useSessions } from '../../lib/queries';
import { date, relative } from '../../lib/format';
import { Badge, Button, CopyField, Input, Modal, SkeletonText, EmptyState } from '../ui';

export function ChangePasswordDialog({ open, onClose, forced }: { open: boolean; onClose: () => void; forced?: boolean }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const m = useApiMutation((b: { currentPassword: string; newPassword: string }) => api.auth.changePassword(b), {
    success: 'Password changed',
    onSuccess: () => {
      setCur('');
      setNext('');
      setConfirm('');
      void refresh();
      // Queries that failed with 403 while the password change was pending must be retried now.
      if (forced) void qc.invalidateQueries();
      onClose();
    },
  });
  const mismatch = confirm.length > 0 && next !== confirm;
  return (
    <Modal
      open={open}
      onClose={forced ? () => undefined : onClose}
      title="Change password"
      description={forced ? 'You must set a new password before continuing.' : 'Use at least 12 characters.'}
      size="sm"
      footer={
        <>
          {!forced && (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="submit" form="change-password-form" loading={m.isPending} disabled={!cur || next.length < 8 || mismatch}>
            Update password
          </Button>
        </>
      }
    >
      <form
        id="change-password-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate({ currentPassword: cur, newPassword: next });
        }}
      >
        <Input label="Current password" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        <Input label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? 'Passwords do not match' : undefined} required />
      </form>
    </Modal>
  );
}

export function TwoFactorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { admin, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const start = useApiMutation(() => api.auth.totpSetup(), { onSuccess: (d) => setSetup(d) });
  const enable = useApiMutation((c: string) => api.auth.totpEnable(c), {
    success: 'Two-factor authentication enabled',
    invalidate: [qk.me],
    onSuccess: () => {
      setSetup(null);
      setCode('');
      void refresh();
      onClose();
    },
  });
  const disable = useApiMutation((c: string) => api.auth.totpDisable(c), {
    success: 'Two-factor authentication disabled',
    invalidate: [qk.me],
    onSuccess: () => {
      setCode('');
      void refresh();
      onClose();
    },
  });
  const close = () => {
    setSetup(null);
    setCode('');
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title="Two-factor authentication" size="sm">
      {admin?.totpEnabled ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate(code);
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">2FA is enabled on your account. Enter a current code to disable it.</p>
          <Input label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <Button type="submit" variant="danger" loading={disable.isPending} className="w-full">
            Disable 2FA
          </Button>
        </form>
      ) : !setup ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">Protect your admin account with a time-based one-time password (TOTP) app such as 1Password, Authy or Google Authenticator.</p>
          <Button onClick={() => start.mutate(undefined)} loading={start.isPending} className="w-full">
            Start setup
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            enable.mutate(code);
          }}
        >
          <div className="flex justify-center rounded-lg bg-white p-3">
            <QRCodeSVG value={setup.otpauthUrl} size={180} includeMargin={false} aria-label="TOTP QR code" />
          </div>
          <CopyField label="Or enter this secret manually" value={setup.secret} />
          <Input label="Code from your app" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <Button type="submit" loading={enable.isPending} className="w-full">
            Verify and enable
          </Button>
        </form>
      )}
    </Modal>
  );
}

export function SessionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sessions = useSessions(open);
  const revoke = useApiMutation((id: string) => api.auth.revokeSession(id), { invalidate: [qk.sessions], success: 'Session revoked' });
  return (
    <Modal open={open} onClose={onClose} title="Active sessions" description="Sign out other devices by revoking their sessions." size="md">
      {sessions.isLoading ? (
        <SkeletonText lines={4} />
      ) : !sessions.data?.items.length ? (
        <EmptyState title="No sessions" />
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {sessions.data.items.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                  <span className="truncate">{s.ip || 'Unknown IP'}</span>
                  {s.current && <Badge tone="accent">This device</Badge>}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={s.userAgent}>
                  {s.userAgent || 'Unknown agent'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Started {relative(s.createdAt)} · expires {date(s.expiresAt)}
                </p>
              </div>
              {!s.current && (
                <Button size="sm" variant="outline" onClick={() => revoke.mutate(s.id)} loading={revoke.isPending && revoke.variables === s.id}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
