import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  required?: boolean;
}

export function Field({ label, hint, error, className, required, id, children }: FieldProps & { id?: string; children: ReactNode }) {
  return (
    <div className={clsx('min-w-0', className)}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
          {required && <span className="text-red-600"> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps & { leftIcon?: ReactNode }>(function Input(
  { label, hint, error, className, required, id, leftIcon, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} className={className} required={required} id={inputId}>
      <div className="relative">
        {leftIcon && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={!!error || undefined}
          className={clsx('input', leftIcon && 'pl-9', error && 'border-red-500')}
          {...rest}
        />
      </div>
    </Field>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps & { mono?: boolean }>(function Textarea(
  { label, hint, error, className, required, id, mono, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} className={className} required={required} id={inputId}>
      <textarea ref={ref} id={inputId} required={required} aria-invalid={!!error || undefined} className={clsx('input min-h-[88px]', mono && 'font-mono text-xs', error && 'border-red-500')} {...rest} />
    </Field>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(function Select(
  { label, hint, error, className, required, id, children, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} className={className} required={required} id={inputId}>
      <select ref={ref} id={inputId} required={required} className={clsx('input appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9', error && 'border-red-500')} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")" }} {...rest}>
        {children}
      </select>
    </Field>
  );
});

export function Checkbox({ label, hint, className, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label htmlFor={inputId} className={clsx('flex min-h-[44px] cursor-pointer items-start gap-3 py-2', className)}>
      <input id={inputId} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-accent-600 focus:ring-accent-500 dark:border-gray-600 dark:bg-gray-900" {...rest} />
      <span className="min-w-0 text-sm">
        <span className="font-medium text-gray-800 dark:text-gray-200">{label}</span>
        {hint && <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, hint, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={clsx('flex min-h-[44px] items-center justify-between gap-4 py-2', className)}>
      <span className="min-w-0 text-sm">
        <span id={id} className="font-medium text-gray-800 dark:text-gray-200">
          {label}
        </span>
        {hint && <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent-600' : 'bg-gray-300 dark:bg-gray-700',
        )}
      >
        <span className={clsx('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </div>
  );
}
