package kz.taxi.qtime.domain;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.time.DayOfWeek;

/**
 * Stores {@link DayOfWeek} as the ISO number 1..7.
 *
 * <p>Not {@code @Enumerated(ORDINAL)}: {@code java.time.DayOfWeek} runs MONDAY..SUNDAY
 * and so does the ISO standard, but an ordinal mapping ties the stored value to the
 * enum's declaration order, which a future refactor can change silently. Writing the
 * number explicitly — and having the DDL constrain it to 1..7 — keeps the week in the
 * database readable by anybody with {@code psql} open.
 */
@Converter(autoApply = true)
public class DayOfWeekConverter implements AttributeConverter<DayOfWeek, Integer> {

    @Override
    public Integer convertToDatabaseColumn(DayOfWeek attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public DayOfWeek convertToEntityAttribute(Integer dbData) {
        return dbData == null ? null : DayOfWeek.of(dbData);
    }
}
