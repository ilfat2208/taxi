import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isApiError, fieldErrorOf } from '../api/errors';
import type { Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Button } from '../components/ui/Button';
import { CheckboxField, TextField } from '../components/ui/Field';
import { DEMO_CODE, DEMO_PHONE, formatPhoneInput, isValidPhone, normalizePhone } from '../lib/phone';

interface LoginErrors {
  phone?: string;
  code?: string;
}

/** Where the user was heading before the guard bounced them to `/login`. */
function redirectTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') ? from : '/';
}

/**
 * Phone + SMS code login against the development identity provider.
 *
 * Two demo affordances are deliberate and visible: the phone is pre-filled, and the
 * screen states that *any* `+7XXXXXXXXXX` number works with the code `0000`. The
 * role checkboxes exist because this identity provider can mint MERCHANT/ADMIN
 * tokens on request — in production they disappear with the provider.
 */
export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = redirectTarget(location.state);

  const [phone, setPhone] = useState(() => formatPhoneInput(DEMO_PHONE));
  const [code, setCode] = useState('');
  const [wantMerchant, setWantMerchant] = useState(false);
  const [wantAdmin, setWantAdmin] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});

  const mutation = useMutation({
    mutationFn: (roles: Role[]) => {
      const normalized = normalizePhone(phone);
      return login({ phone: normalized ?? phone, code: code.trim(), roles });
    },
    onSuccess: () => navigate(from, { replace: true }),
  });

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const submit = () => {
    if (mutation.isPending) {
      return;
    }
    const nextErrors: LoginErrors = {};
    if (!isValidPhone(phone)) {
      nextErrors.phone = 'Введите номер в формате +7 700 000 00 00';
    }
    if (!/^\d{4,8}$/.test(code.trim())) {
      nextErrors.code = 'Код состоит из 4 цифр (в демо — 0000)';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const roles: Role[] = ['CUSTOMER'];
    if (wantMerchant) {
      roles.push('MERCHANT');
    }
    if (wantAdmin) {
      roles.push('ADMIN');
    }
    mutation.mutate(roles);
  };

  const isBadCode = isApiError(mutation.error) && mutation.error.status === 401;

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-500 text-lg font-bold text-white">
            O
          </span>
          <h1 className="text-2xl font-semibold text-ink-900">ORTA</h1>
          <p className="mt-1 text-sm text-ink-500">
            Войдите по номеру телефона — счёт, переводы, платежи и маркетплейс в одном приложении.
          </p>
        </div>

        <form
          className="space-y-4 rounded-card border border-ink-200 bg-white p-5 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          noValidate
        >
          <TextField
            id="login-phone"
            label="Номер телефона"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
            error={errors.phone ?? fieldErrorOf(mutation.error, 'phone')}
            hint="Демо-номер уже подставлен — подойдёт любой +7XXXXXXXXXX"
            required
          />

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                id="login-code"
                label="Код из SMS"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                error={errors.code ?? fieldErrorOf(mutation.error, 'code')}
                hint={`В демо-режиме код всегда ${DEMO_CODE}`}
                required
              />
            </div>
            <Button variant="secondary" onClick={() => setCode(DEMO_CODE)} className="mb-6">
              Ввести {DEMO_CODE}
            </Button>
          </div>

          <Alert tone="info" title="Это учебный провайдер идентичности">
            Любой номер вида <span className="font-medium">+7XXXXXXXXXX</span> принимается с кодом{' '}
            <span className="font-medium">{DEMO_CODE}</span>. В продакшене вместо него внешний OIDC — сервисы
            проверяют токен локально.
          </Alert>

          <fieldset className="space-y-3 rounded-xl bg-ink-50 p-3">
            <legend className="px-1 text-sm font-medium text-ink-700">Роли для демо (необязательно)</legend>
            <CheckboxField
              id="login-role-admin"
              label="Запросить роль ADMIN"
              hint="Открывает демо-пополнение счёта на главной"
              checked={wantAdmin}
              onChange={(event) => setWantAdmin(event.target.checked)}
            />
            <CheckboxField
              id="login-role-merchant"
              label="Запросить роль MERCHANT"
              hint="Открывает раздел «Мой магазин»"
              checked={wantMerchant}
              onChange={(event) => setWantMerchant(event.target.checked)}
            />
            <p className="text-xs text-ink-500">Роль CUSTOMER выдаётся всегда.</p>
          </fieldset>

          {mutation.error ? (
            <ErrorAlert
              error={mutation.error}
              title={isBadCode ? 'Неверный код подтверждения' : 'Не удалось войти'}
            />
          ) : null}

          <Button type="submit" block size="lg" loading={mutation.isPending} disabled={mutation.isPending}>
            Войти
          </Button>
        </form>
      </div>
    </div>
  );
}
