import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelBooking,
  createBooking,
  fetchBookings,
  fetchQtimeCompanies,
  fetchQtimeCompany,
  fetchQtimeSlots,
} from '../api/endpoints';
import type { BookingQuery, CreateBookingRequest, QtimeCompanyQuery } from '../api/types';
import { queryKeys } from '../lib/queryKeys';

/**
 * QTime server state.
 *
 * The catalogue and the free windows are public reads: no session is required to
 * browse companies or to ask what is free, so these queries are not gated on the
 * session and simply carry the token when there is one. Only booking and
 * cancelling need an identity.
 */

/** Company list: free-text search plus the category and city filters. */
export function useQtimeCompanies(query: QtimeCompanyQuery) {
  return useQuery({
    queryKey: queryKeys.qtimeCompanies(query),
    queryFn: () => fetchQtimeCompanies(query),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function useQtimeCompany(companyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.qtimeCompany(companyId ?? 'none'),
    queryFn: () => fetchQtimeCompany(companyId as string),
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}

export interface SlotsQuery {
  specialistId: string | null;
  serviceId: string | null;
  /** Calendar day in the schedule's zone (`YYYY-MM-DD`). */
  date: string;
}

/**
 * Free windows of one specialist for one service on one day.
 *
 * Disabled until both a specialist and a service are picked: a window belongs to
 * a pair, and the duration of the service decides how many fit.
 */
export function useQtimeSlots({ specialistId, serviceId, date }: SlotsQuery) {
  const ready = Boolean(specialistId) && Boolean(serviceId) && date !== '';
  return useQuery({
    queryKey: queryKeys.qtimeSlots(specialistId ?? 'none', serviceId ?? 'none', date),
    queryFn: () =>
      fetchQtimeSlots({
        specialistId: specialistId as string,
        serviceId: serviceId as string,
        date,
      }),
    enabled: ready,
    // Availability moves as other riders book; a short cache keeps two clicks on
    // the same day from double-fetching without showing windows that are gone.
    staleTime: 15_000,
    retry: 1,
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateBookingRequest; idempotencyKey: string }) =>
      createBooking(body, idempotencyKey),
    retry: 0,
    onSuccess: (booking) => {
      void queryClient.invalidateQueries({ queryKey: ['qtime', 'bookings'] });
      // The window just taken must disappear from the grid.
      void queryClient.invalidateQueries({ queryKey: ['qtime', 'slots'] });
      return booking;
    },
  });
}

export function useBookings(query: BookingQuery) {
  return useQuery({
    queryKey: queryKeys.qtimeBookings(query),
    queryFn: () => fetchBookings(query),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason: string }) =>
      cancelBooking(bookingId, { reason }),
    retry: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['qtime', 'bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['qtime', 'slots'] });
    },
  });
}
