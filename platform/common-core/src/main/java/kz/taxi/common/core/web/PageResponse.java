package kz.taxi.common.core.web;

import java.util.List;
import java.util.function.Function;

/**
 * Transport-agnostic page envelope.
 *
 * <p>Spring Data's {@code Page} is deliberately not exposed at the REST
 * boundary: its JSON shape is unstable across versions and leaks persistence
 * details. Services map to this record instead.
 */
public record PageResponse<T>(
        List<T> items,
        int page,
        int size,
        long totalElements,
        int totalPages,
        boolean hasNext
) {

    public static <T> PageResponse<T> of(List<T> items, int page, int size, long totalElements) {
        int totalPages = size <= 0 ? 0 : (int) Math.ceil((double) totalElements / size);
        return new PageResponse<>(List.copyOf(items), page, size, totalElements, totalPages, page + 1 < totalPages);
    }

    public static <S, T> PageResponse<T> of(List<S> source, int page, int size, long totalElements,
                                            Function<S, T> mapper) {
        return of(source.stream().map(mapper).toList(), page, size, totalElements);
    }

    public static <T> PageResponse<T> empty(int page, int size) {
        return new PageResponse<>(List.of(), page, size, 0L, 0, false);
    }
}
