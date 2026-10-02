import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addCartItem, clearCart, fetchCart, removeCartItem, updateCartItem } from '../api/endpoints';
import { multiplyMinor, sumMinor } from '../api/money';
import type { Cart, CartItem, Product } from '../api/types';
import { queryKeys } from '../lib/queryKeys';
import { useAuth } from '../auth/AuthContext';

/** Line totals and the cart totals are always recomputed from the items. */
function recalculate(cart: Cart, items: CartItem[]): Cart {
  const itemsTotalMinor = sumMinor(
    items.map((item) => item.totalMinor ?? multiplyMinor(item.priceMinor, item.quantity)),
  );
  return {
    ...cart,
    items,
    itemCount: items.reduce((count, item) => count + item.quantity, 0),
    itemsTotalMinor,
    totalMinor: itemsTotalMinor + cart.deliveryMinor,
  };
}

export function useCart() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.cart(),
    queryFn: fetchCart,
    enabled: isAuthenticated,
    staleTime: 5_000,
    retry: 0,
  });
}

interface AddVariables {
  productId: string;
  quantity: number;
  /** Supplied so the optimistic line can be rendered before the server answers. */
  product?: Product;
}

export function useAddToCart() {
  const queryClient = useQueryClient();
  const key = queryKeys.cart();

  return useMutation<Cart, unknown, AddVariables, { previous: Cart | undefined }>({
    mutationFn: ({ productId, quantity }) => addCartItem({ productId, quantity }),
    retry: 0,
    onMutate: async ({ productId, quantity, product }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Cart>(key);
      if (previous) {
        const existing = previous.items.find((item) => item.productId === productId);
        const items: CartItem[] = existing
          ? previous.items.map((item) =>
              item.productId === productId ? { ...item, quantity: item.quantity + quantity } : item,
            )
          : [
              ...previous.items,
              {
                itemId: `optimistic-${productId}`,
                productId,
                title: product?.title ?? 'Товар',
                priceMinor: product?.priceMinor ?? 0,
                currency: product?.currency ?? previous.currency,
                quantity,
                imageUrl: product?.imageUrl ?? null,
                merchantId: product?.merchantId ?? null,
                merchantName: product?.merchantName ?? null,
                availableQuantity: product?.availableQuantity ?? null,
              } satisfies CartItem,
            ];
        const withTotals = items.map((item) => ({
          ...item,
          totalMinor: multiplyMinor(item.priceMinor, item.quantity),
        }));
        queryClient.setQueryData<Cart>(key, recalculate(previous, withTotals));
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

interface UpdateVariables {
  itemId: string;
  quantity: number;
}

export function useUpdateCartItem() {
  const queryClient = useQueryClient();
  const key = queryKeys.cart();

  return useMutation<Cart, unknown, UpdateVariables, { previous: Cart | undefined }>({
    mutationFn: ({ itemId, quantity }) => updateCartItem(itemId, { quantity }),
    retry: 0,
    onMutate: async ({ itemId, quantity }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Cart>(key);
      if (previous) {
        const items = previous.items.map((item) =>
          item.itemId === itemId
            ? { ...item, quantity, totalMinor: multiplyMinor(item.priceMinor, quantity) }
            : item,
        );
        queryClient.setQueryData<Cart>(key, recalculate(previous, items));
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useRemoveCartItem() {
  const queryClient = useQueryClient();
  const key = queryKeys.cart();

  return useMutation<Cart, unknown, { itemId: string }, { previous: Cart | undefined }>({
    mutationFn: ({ itemId }) => removeCartItem(itemId),
    retry: 0,
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Cart>(key);
      if (previous) {
        queryClient.setQueryData<Cart>(
          key,
          recalculate(
            previous,
            previous.items.filter((item) => item.itemId !== itemId),
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useClearCart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearCart(),
    retry: 0,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cart() });
    },
  });
}
