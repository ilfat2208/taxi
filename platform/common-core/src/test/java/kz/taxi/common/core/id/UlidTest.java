package kz.taxi.common.core.id;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class UlidTest {

    @Test
    @DisplayName("renders 26 Crockford base32 characters")
    void renders_expected_shape() {
        String id = Ulid.nextId();

        assertThat(id).hasSize(26).matches("[0-9A-HJKMNP-TV-Z]{26}");
    }

    @Test
    @DisplayName("100k ids in a burst are unique and strictly increasing")
    void is_monotonic_and_unique() {
        int count = 100_000;
        List<String> ids = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            ids.add(Ulid.nextId());
        }

        Set<String> unique = new HashSet<>(ids);
        assertThat(unique).hasSize(count);

        List<String> sorted = ids.stream().sorted().toList();
        assertThat(sorted).isEqualTo(ids);
    }

    @Test
    @DisplayName("lexicographic order follows time order across milliseconds")
    void sorts_chronologically() throws InterruptedException {
        Ulid before = Ulid.generate();
        Thread.sleep(5);
        Ulid after = Ulid.generate();

        assertThat(before.compareTo(after)).isNegative();
        assertThat(before.toString()).isLessThan(after.toString());
    }

    @Test
    @DisplayName("round-trips through parse without losing bits")
    void round_trips() {
        Ulid original = Ulid.generate();

        Ulid parsed = Ulid.parse(original.toString());

        assertThat(parsed).isEqualTo(original);
        assertThat(parsed.randomness()).isEqualTo(original.randomness());
        assertThat(parsed.toString()).isEqualTo(original.toString());
    }

    @Test
    @DisplayName("timestamp survives the encoding")
    void keeps_timestamp() {
        Instant before = Instant.now().minusMillis(1000);

        Ulid ulid = Ulid.generate();

        assertThat(ulid.timestamp()).isAfter(before).isBefore(Instant.now().plusMillis(1000));
    }

    @Test
    @DisplayName("accepts Crockford aliases I/L/O when parsing")
    void accepts_aliases() {
        Ulid ulid = Ulid.parse("01ARZ3NDEKTSV4RRFFQ69G5FAV");

        assertThat(Ulid.parse(ulid.toString().replace('0', 'O'))).isEqualTo(ulid);
    }

    @Test
    @DisplayName("rejects malformed input")
    void rejects_invalid() {
        assertThatThrownBy(() -> Ulid.parse("too-short")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Ulid.parse("01ARZ3NDEKTSV4RRFFQ69G5FAU")).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("invalid ULID character");
        assertThatThrownBy(() -> Ulid.parse(null)).isInstanceOf(NullPointerException.class);

        assertThat(Ulid.isValid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).isTrue();
        assertThat(Ulid.isValid("nope")).isFalse();
        assertThat(Ulid.isValid(null)).isFalse();
    }
}
