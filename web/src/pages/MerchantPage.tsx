import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, parseAmountInput, toMajorString } from '../api/money';
import { fieldErrorOf, isApiError } from '../api/errors';
import type { Currency, Product } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/layout/PageHeader';
import { ProductThumb } from '../components/market/ProductThumb';
import { AmountField } from '../components/ui/AmountField';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextAreaField, TextField } from '../components/ui/Field';
import { SkeletonCards } from '../components/ui/Skeleton';
import { PageLoader } from '../components/ui/Spinner';
import { useCategories, useCreateProduct, useProducts, useUpdateProduct } from '../hooks/useCatalog';
import { useCreateMerchant, useMyMerchant } from '../hooks/useMerchant';
import { useProfile } from '../hooks/useProfile';
import { formatDate } from '../lib/format';
import { formatPhoneInput, normalizePhone } from '../lib/phone';

const CURRENCIES: Currency[] = ['KZT', 'USD', 'EUR', 'RUB'];

/** Onboarding: one merchant profile per user (`POST /merchants`). */
function MerchantOnboardingForm({ defaultPhone }: { defaultPhone: string }) {
  const create = useCreateMerchant();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState(() => formatPhoneInput(defaultPhone));
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (create.isPending) {
          return;
        }
        const next: { name?: string; email?: string } = {};
        if (name.trim().length < 2) {
          next.name = 'Укажите название магазина';
        }
        if (email.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
          next.email = 'Проверьте адрес электронной почты';
        }
        setErrors(next);
        if (Object.keys(next).length > 0) {
          return;
        }
        create.mutate({
          name: name.trim(),
          displayName: displayName.trim() || undefined,
          phone: normalizePhone(phone) ?? undefined,
          email: email.trim() || undefined,
          city: city.trim() || undefined,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="merchant-name"
          label="Название магазина"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name ?? fieldErrorOf(create.error, 'name')}
          required
        />
        <TextField
          id="merchant-display-name"
          label="Отображаемое имя"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          hint="Так магазин увидят покупатели"
        />
        <TextField
          id="merchant-phone"
          label="Телефон"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
        />
        <TextField
          id="merchant-email"
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email ?? fieldErrorOf(create.error, 'email')}
        />
        <TextField
          id="merchant-city"
          label="Город"
          value={city}
          onChange={(event) => setCity(event.target.value)}
        />
      </div>

      {create.error ? <ErrorAlert error={create.error} title="Не удалось создать профиль" /> : null}

      <Button type="submit" loading={create.isPending} disabled={create.isPending}>
        Создать профиль мерчанта
      </Button>
    </form>
  );
}

/** Publishing a new offer (`POST /catalog/products`, MERCHANT only). */
function CreateProductForm({ onCreated }: { onCreated?: () => void }) {
  const categoriesQuery = useCategories();
  const create = useCreateProduct();
  const [title, setTitle] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [priceText, setPriceText] = useState('');
  const [currency, setCurrency] = useState<Currency>('KZT');
  const [initialStock, setInitialStock] = useState('10');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const parsedPrice = parseAmountInput(priceText, { label: 'цену' });
  const parsedStock = Number(initialStock.replace(/\D/g, '') || '0');

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (create.isPending) {
          return;
        }
        const next: Record<string, string | undefined> = {};
        if (title.trim().length < 2) {
          next.title = 'Название не короче 2 символов';
        }
        if (sku.trim().length < 1) {
          next.sku = 'Укажите SKU (артикул) — он уникален внутри магазина';
        }
        if (category.trim().length < 1) {
          next.category = 'Выберите или введите категорию';
        }
        if (!parsedPrice.ok) {
          next.price = parsedPrice.ok ? undefined : parsedPrice.message;
        }
        if (!Number.isFinite(parsedStock) || parsedStock < 0) {
          next.stock = 'Остаток не может быть отрицательным';
        }
        setErrors(next);
        if (Object.values(next).some(Boolean) || !parsedPrice.ok) {
          return;
        }

        create.mutate(
          {
            title: title.trim(),
            sku: sku.trim(),
            category: category.trim(),
            brand: brand.trim() || undefined,
            priceMinor: parsedPrice.minor,
            currency,
            initialStock: parsedStock,
            description: description.trim() || undefined,
            imageUrl: imageUrl.trim() || undefined,
          },
          {
            onSuccess: () => {
              setTitle('');
              setSku('');
              setPriceText('');
              setDescription('');
              setImageUrl('');
              onCreated?.();
            },
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="product-title"
          label="Название товара"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          error={errors.title ?? fieldErrorOf(create.error, 'title')}
          required
        />
        <TextField
          id="product-sku"
          label="SKU (артикул)"
          value={sku}
          onChange={(event) => setSku(event.target.value)}
          error={errors.sku ?? fieldErrorOf(create.error, 'sku')}
          hint="Уникален внутри вашего магазина: повтор вернёт 409 DUPLICATE_SKU"
          required
        />

        <TextField
          id="product-category"
          label="Категория"
          value={category}
          list="product-categories"
          onChange={(event) => setCategory(event.target.value)}
          error={errors.category ?? fieldErrorOf(create.error, 'category')}
          hint="Можно выбрать существующую или ввести новую"
          required
        />
        <datalist id="product-categories">
          {(categoriesQuery.data ?? []).map((entry) => (
            <option key={entry.slug ?? entry.name} value={entry.slug ?? entry.name} />
          ))}
        </datalist>

        <TextField
          id="product-brand"
          label="Бренд"
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
        />

        <AmountField
          id="product-price"
          label="Цена"
          value={priceText}
          onValueChange={setPriceText}
          currency={currency}
          error={errors.price ?? fieldErrorOf(create.error, 'priceMinor')}
        />

        <SelectField
          id="product-currency"
          label="Валюта"
          value={currency}
          options={CURRENCIES.map((code) => ({ value: code, label: code }))}
          onChange={(event) => setCurrency(event.target.value as Currency)}
        />

        <TextField
          id="product-stock"
          label="Начальный остаток, шт."
          inputMode="numeric"
          value={initialStock}
          onChange={(event) => setInitialStock(event.target.value.replace(/\D/g, ''))}
          error={errors.stock ?? fieldErrorOf(create.error, 'initialStock')}
        />

        <TextField
          id="product-image"
          label="Ссылка на изображение"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          hint="Необязательно: https://…"
        />
      </div>

      <TextAreaField
        id="product-description"
        label="Описание"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        hint="Полнотекстовый поиск в маркете ищет и по описанию"
      />

      {create.error ? <ErrorAlert error={create.error} title="Товар не опубликован" /> : null}
      {create.isSuccess ? <Alert tone="success" title="Товар опубликован" /> : null}

      <Button type="submit" loading={create.isPending} disabled={create.isPending}>
        Опубликовать товар
      </Button>
    </form>
  );
}

/** Row with an inline price / stock adjustment (`PATCH /catalog/products/{id}`). */
function MerchantProductRow({ product }: { product: Product }) {
  const update = useUpdateProduct();
  const [open, setOpen] = useState(false);
  const [priceText, setPriceText] = useState(() => toMajorString(product.priceMinor));
  const [stockDelta, setStockDelta] = useState('');

  const parsedPrice = parseAmountInput(priceText, { label: 'цену' });
  const delta = Number(stockDelta.replace(/[^\d-]/g, '') || '0');

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-ink-100">
          <ProductThumb imageUrl={product.imageUrl} title={product.title} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-900">{product.title}</p>
          <p className="text-xs text-ink-500">
            {product.sku ? `SKU ${product.sku} · ` : ''}
            {product.category ?? 'без категории'} · остаток {product.availableQuantity}
          </p>
        </div>

        <p className="tnum shrink-0 text-sm font-semibold text-ink-900">
          {formatMoney(product.priceMinor, product.currency)}
        </p>
        <StatusBadge status={product.status} />

        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? 'Скрыть' : 'Изменить'}
        </Button>
      </div>

      {open ? (
        <form
          className="mt-3 space-y-3 rounded-xl bg-ink-50 p-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (update.isPending || !parsedPrice.ok) {
              return;
            }
            update.mutate({
              productId: product.id,
              body: {
                priceMinor: parsedPrice.minor,
                stockDelta: Number.isFinite(delta) && delta !== 0 ? delta : undefined,
                stockReason: 'Обновление из кабинета мерчанта',
              },
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <AmountField
              id={`product-price-${product.id}`}
              label="Новая цена"
              value={priceText}
              onValueChange={setPriceText}
              currency={product.currency}
              error={parsedPrice.ok ? undefined : parsedPrice.message}
            />
            <TextField
              id={`product-delta-${product.id}`}
              label="Изменение остатка, шт."
              inputMode="numeric"
              value={stockDelta}
              placeholder="например: 5 или -2"
              onChange={(event) => setStockDelta(event.target.value)}
              hint="Дельта, а не новое значение: параллельные правки складываются"
            />
          </div>

          {update.error ? <ErrorAlert error={update.error} title="Не удалось обновить товар" /> : null}
          {update.isSuccess ? <Alert tone="success" title="Товар обновлён" /> : null}

          <Button type="submit" size="sm" loading={update.isPending} disabled={update.isPending}>
            Сохранить
          </Button>
        </form>
      ) : null}
    </li>
  );
}

/**
 * Merchant console (MERCHANT role only).
 *
 * Three blocks in the order a seller needs them: the profile (or onboarding), the
 * catalogue with inline stock/price edits, and the publishing form.
 */
export function MerchantPage() {
  const { session } = useAuth();
  const merchantQuery = useMyMerchant();
  const profile = useProfile();

  const merchant = merchantQuery.data ?? null;
  const merchantId = merchant?.id ?? profile.data?.merchantId ?? null;
  const productsQuery = useProducts({ merchantId: merchantId ?? undefined, size: 24, sort: 'newest' }, merchantId !== null);

  const missingProfile = merchantQuery.isError && isApiError(merchantQuery.error) && merchantQuery.error.isNotFound;

  return (
    <>
      <PageHeader
        title="Мой магазин"
        subtitle="Профиль продавца, товары и остатки"
        actions={
          <Link to="/market" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            Как видят покупатели
          </Link>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Профиль мерчанта"
            subtitle="Один профиль на пользователя"
            action={merchant ? <StatusBadge status={merchant.status ?? 'ACTIVE'} /> : null}
          />
          <CardBody>
            {merchantQuery.isPending ? <PageLoader label="Загружаем профиль…" /> : null}

            {merchantQuery.isError && !missingProfile ? (
              <ErrorAlert
                error={merchantQuery.error}
                title="Не удалось загрузить профиль мерчанта"
                onRetry={() => void merchantQuery.refetch()}
              />
            ) : null}

            {missingProfile ? (
              <>
                <Alert tone="info" title="Профиль ещё не создан">
                  Заполните данные магазина — после этого можно публиковать товары.
                </Alert>
                <div className="mt-4">
                  <MerchantOnboardingForm defaultPhone={session?.phone ?? ''} />
                </div>
              </>
            ) : null}

            {merchant ? (
              <dl>
                <DetailRow label="Название">{merchant.name}</DetailRow>
                <DetailRow label="Отображаемое имя">{merchant.displayName || merchant.name}</DetailRow>
                <DetailRow label="Город">{merchant.city || '—'}</DetailRow>
                <DetailRow label="Телефон">{merchant.phone || '—'}</DetailRow>
                <DetailRow label="Email">{merchant.email || '—'}</DetailRow>
                <DetailRow label="Рейтинг">
                  {typeof merchant.ratingBasisPoints === 'number'
                    ? `${(merchant.ratingBasisPoints / 100).toFixed(1)} / 5`
                    : '—'}
                </DetailRow>
                <DetailRow label="Создан">{formatDate(merchant.createdAt)}</DetailRow>
                <DetailRow label="ID мерчанта">
                  <span className="font-mono text-xs">{merchant.id}</span>
                </DetailRow>
              </dl>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Мои товары"
            subtitle={productsQuery.data ? `Опубликовано: ${productsQuery.data.totalElements}` : undefined}
            action={merchantId ? <Badge tone="neutral">merchantId {merchantId.slice(0, 10)}…</Badge> : null}
          />
          <CardBody>
            {!merchantId ? (
              <EmptyState
                title="Нет профиля мерчанта"
                description="Сначала создайте профиль магазина — товары привязываются к нему."
              />
            ) : null}

            {merchantId && productsQuery.isPending ? <SkeletonCards count={3} className="sm:grid-cols-2" /> : null}

            {merchantId && productsQuery.isError ? (
              <ErrorAlert
                error={productsQuery.error}
                title="Не удалось загрузить товары"
                onRetry={() => void productsQuery.refetch()}
              />
            ) : null}

            {merchantId && productsQuery.data && productsQuery.data.items.length === 0 ? (
              <EmptyState
                title="Товаров пока нет"
                description="Опубликуйте первый товар — он сразу появится в маркете."
              />
            ) : null}

            {merchantId && productsQuery.data && productsQuery.data.items.length > 0 ? (
              <ul className="divide-y divide-ink-100">
                {productsQuery.data.items.map((product) => (
                  <MerchantProductRow key={product.id} product={product} />
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Новый товар" subtitle="Публикация в каталоге (роль MERCHANT)" />
          <CardBody>
            <CreateProductForm
              onCreated={() => {
                void productsQuery.refetch();
              }}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
