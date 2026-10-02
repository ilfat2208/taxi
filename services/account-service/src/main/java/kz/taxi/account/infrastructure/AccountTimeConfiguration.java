package kz.taxi.account.infrastructure;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * Time as a dependency.
 *
 * <p>Limit windows are calendar windows, so "which day is it" is part of the
 * business rule and has to be injectable: a test that can only express itself in
 * terms of the wall clock cannot check that a daily limit resets at midnight, and
 * a service that reads {@code Instant.now()} inside a rule cannot be reasoned
 * about at all.
 *
 * <p>UTC explicitly: window boundaries must be the same fact on every replica,
 * regardless of where the container happens to run.
 */
@Configuration
public class AccountTimeConfiguration {

    /** Named to stay clear of Micrometer's {@code Clock} bean (a different type). */
    @Bean
    public Clock accountClock() {
        return Clock.systemUTC();
    }
}
