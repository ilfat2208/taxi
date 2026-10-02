# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# dispatch-service — multi-stage build.
#
# The whole reactor is copied because this module depends on the platform
# libraries and on the parent POM's dependency management: a build that cannot
# see them is not the build we tested.
#
# The BuildKit cache mount keeps ~/.m2 between builds, so a rebuild after a code
# change compiles instead of re-downloading Spring Boot and Kafka clients. The
# cache id is PER SERVICE on purpose: Compose builds the images in parallel and
# Maven's local repository is not safe for concurrent writers.
# ---------------------------------------------------------------------------
FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /workspace

COPY pom.xml .
COPY platform/ platform/
COPY services/ services/

# -am also builds the platform modules this service depends on.
RUN --mount=type=cache,target=/root/.m2,id=m2-dispatch-service,sharing=locked \
    mvn -B -ntp -pl services/dispatch-service -am -DskipTests package

FROM eclipse-temurin:17-jre-alpine AS runtime

RUN addgroup -S taxi && adduser -S -G taxi taxi

WORKDIR /app
COPY --from=build /workspace/services/dispatch-service/target/dispatch-service-*.jar app.jar
RUN chown -R taxi:taxi /app
USER taxi

# $ is escaped so the value is expanded by the shell at container start, not
# baked in at build time: JAVA_OPTS must be tunable per environment.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8087

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://localhost:8087/actuator/health | grep -q UP || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
