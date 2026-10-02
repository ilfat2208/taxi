import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createProduct, fetchCategories, fetchProduct, fetchProducts, updateProduct } from '../api/endpoints';
import type { CreateProductRequest, ProductQuery, UpdateProductRequest } from '../api/types';
import { queryKeys } from '../lib/queryKeys';

export function useProducts(query: ProductQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.products(query),
    queryFn: () => fetchProducts(query),
    enabled,
    staleTime: 20_000,
    placeholderData: (previous) => previous,
  });
}

export function useProduct(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.product(productId ?? 'none'),
    queryFn: () => fetchProduct(productId as string),
    enabled: Boolean(productId),
    staleTime: 20_000,
  });
}

/** Public endpoint: categories of products currently on sale. */
export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories(),
    queryFn: fetchCategories,
    staleTime: 5 * 60_000,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProductRequest) => createProduct(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories() });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, body }: { productId: string; body: UpdateProductRequest }) =>
      updateProduct(productId, body),
    onSuccess: (product) => {
      queryClient.setQueryData(queryKeys.product(product.id), product);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
    },
  });
}
