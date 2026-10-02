package kz.taxi.common.security.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.web.error.ApiProblem;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;

import java.io.IOException;

/**
 * 401 responses in the same RFC 7807 shape as every other error.
 *
 * <p>Without this, an unauthenticated call returns an empty body from the
 * servlet container while the rest of the API returns problem documents — a
 * difference every client would have to special-case.
 */
@Slf4j
public class RestAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;
    private final String problemBaseUri;

    public RestAuthenticationEntryPoint(ObjectMapper objectMapper, String problemBaseUri) {
        this.objectMapper = objectMapper;
        this.problemBaseUri = problemBaseUri;
    }

    @Override
    public void commence(HttpServletRequest request,
                         HttpServletResponse response,
                         AuthenticationException authException) throws IOException {
        log.debug("rejecting unauthenticated request to {} {}: {}", request.getMethod(),
                request.getRequestURI(), authException.getMessage());

        ApiProblem problem = ApiProblem.of(CommonErrorCode.UNAUTHORIZED,
                "a valid bearer token is required for %s %s".formatted(request.getMethod(), request.getRequestURI()),
                request.getRequestURI(), CorrelationContext.get(), problemBaseUri);

        response.setStatus(problem.status());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
