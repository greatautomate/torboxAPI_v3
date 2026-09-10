import { useState } from 'react';
import { KeyRound, MoreHorizontal, Plus, ShieldOff, Trash2, UserX, UserCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { qk, useAdmins, useApiMutation } from '../../lib/queries';
import type { Admin, Role } from '../../lib/types';
import { date } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, Input, Menu, Modal, Select, type Column } from '../../components/ui';
import { PageHeader } from '../../components/admin/PageHeader';

export function AdminsPage() {
  const q = useAdmins();
  const { isOwner, admin: me } = useAuth();
  const [create, setCreate] = useState(false);
  const [role, setRole] = useState<Admin | null>(null);
  const [pw, setPw] = useState<Admin | null>(null);
  const [del, setDel] = useState<Admin | null>(null);
  const [totp, setTotp] = useState<Admin | null>(null);
  const inv = [qk.admins];
  const update = useApiMutation((v: { id: string; body: { role?: Role; disabled?: boolean } }) => api.admins.update(v.id, v.body), { invalidate: inv, success: 'Admin updated' });
  const remove = useApiMutation((id: string) => api.admins.remove(id), { invalidate: inv, success: 'Admin deleted' });
  const resetTotp = useApiMutation((id: string) => api.admins.resetTotp(id), { invalidate: inv, success: '2FA reset — the admin can enrol again' });

  const cols: Column<Admin>[] = [
    { key: 'email', header: 'Email', primary: true, render: (a) => <span className="flex items-center gap-2 font-medium">{a.email}{a.id === me?.id && <Badge tone="accent">you</Badge>}</span> },
    { key: 'role', header: 'Role', render: (a) => <Badge tone={a.role === 'owner' ? 'accent' : a.role === 'admin' ? 'info' : 'neutral'}>{a.role}</Badge> },
    { key: 'status', header: 'Status', render: (a) => (a.disabled ? <Badge tone="danger">disabled</Badge> : <Badge tone="success">active</Badge>) },
    { key: 'totp', header: '2FA', render: (a) => (a.totpEnabled ? <Badge tone="success">enabled</Badge> : <Badge>off</Badge>) },
    { key: 'pw', header: 'Password', render: (a) => (a.mustChangePassword ? <Badge tone="warning">must change</Badge> : <span className="text-xs text-gray-400">ok</span>), hideOnMobile: true },
    { key: 'created', header: 'Created', render: (a) => <span className="text-xs text-gray-500">{date(a.createdAt, { dateStyle: 'medium' })}</span>, hideOnMobile: true },
  ];
  return (
    <div>
      <PageHeader
        title="Admins"
        description="People who can sign in to this dashboard. Owner > admin > viewer (read-only)."
        actions={
          isOwner && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreate(true)}>
              Add admin
            </Button>
          )
        }
      />
      <DataTable
        columns={cols}
        rows={q.data?.items}
        rowKey={(a) => a.id}
        loading={q.isLoading}
        empty={<EmptyState title="No admins" />}
        actions={(a) =>
          isOwner && a.id !== me?.id ? (
            <Menu
              trigger={
                <Button variant="ghost" size="icon" aria-label={`Actions for ${a.email}`}>
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              }
              items={[
                { label: 'Change role', onClick: () => setRole(a) },
                { label: a.disabled ? 'Enable' : 'Disable', icon: a.disabled ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />, onClick: () => update.mutate({ id: a.id, body: { disabled: !a.disabled } }) },
                { label: 'Reset password', icon: <KeyRound className="h-4 w-4" />, onClick: () => setPw(a) },
                { label: 'Reset 2FA', icon: <ShieldOff className="h-4 w-4" />, onClick: () => setTotp(a), disabled: !a.totpEnabled },
                { divider: true, label: '' },
                { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setDel(a) },
              ]}
            />
          ) : null
        }
      />
      <CreateAdminModal open={create} onClose={() => setCreate(false)} />
      <RoleModal item={role} onClose={() => setRole(null)} onSave={(r) => update.mutateAsync({ id: role!.id, body: { role: r } })} />
      <PasswordModal item={pw} onClose={() => setPw(null)} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title={`Delete ${del?.email}?`} description="Their sessions are terminated immediately." confirmLabel="Delete" onConfirm={() => remove.mutateAsync(del!.id)} />
      <ConfirmDialog open={!!totp} onClose={() => setTotp(null)} title={`Reset 2FA for ${totp?.email}?`} description="Their authenticator is removed; they can sign in with password only until they enrol again." confirmLabel="Reset 2FA" onConfirm={() => resetTotp.mutateAsync(totp!.id)} />
    </div>
  );
}

function CreateAdminModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ email: '', password: '', role: 'admin' as Role });
  const m = useApiMutation((b: typeof f) => api.admins.create(b), {
    invalidate: [qk.admins],
    success: 'Admin created',
    onSuccess: () => {
      setF({ email: '', password: '', role: 'admin' });
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add admin"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-admin" loading={m.isPending} disabled={!f.email || f.password.length < 8}>
            Create
          </Button>
        </>
      }
    >
      <form id="create-admin" className="space-y-4" onSubmit={(e) => (e.preventDefault(), m.mutate(f))}>
        <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required data-autofocus />
        <Input label="Temporary password" type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} hint="They will be asked to change it on first login." />
        <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
          <option value="viewer">viewer (read-only)</option>
          <option value="admin">admin</option>
          <option value="owner">owner</option>
        </Select>
      </form>
    </Modal>
  );
}

function RoleModal({ item, onClose, onSave }: { item: Admin | null; onClose: () => void; onSave: (r: Role) => Promise<unknown> }) {
  const [r, setR] = useState<Role>('admin');
  return (
    <ConfirmDialog open={!!item} onClose={onClose} title={`Change role for ${item?.email}`} confirmLabel="Save role" onConfirm={() => onSave(r)}>
      <Select label="Role" value={r} onChange={(e) => setR(e.target.value as Role)}>
        <option value="viewer">viewer</option>
        <option value="admin">admin</option>
        <option value="owner">owner</option>
      </Select>
    </ConfirmDialog>
  );
}

function PasswordModal({ item, onClose }: { item: Admin | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const m = useApiMutation((v: { id: string; password: string }) => api.admins.resetPassword(v.id, v.password), {
    invalidate: [qk.admins],
    success: 'Password reset',
    onSuccess: () => {
      setPw('');
      onClose();
    },
  });
  return (
    <ConfirmDialog open={!!item} onClose={onClose} title={`Reset password for ${item?.email}`} description="They will be required to change it after signing in." confirmLabel="Reset password" onConfirm={() => m.mutateAsync({ id: item!.id, password: pw })}>
      <Input label="New temporary password" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} />
    </ConfirmDialog>
  );
}
