package kz.taxi.common.security.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.web.error.ApiProblem;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;

import java.io.IOException;

/**
 * 403 responses in problem+json shape.
 *
 * <p>Logs the authenticated subject, never the token: an access-denied line in
 * the log must be safe to paste into an incident channel.
 */
@Slf4j
public class RestAccessDeniedHandler implements AccessDeniedHandler {

    private final ObjectMapper objectMapper;
    private final String problemBaseUri;

    public RestAccessDeniedHandler(ObjectMapper objectMapper, String problemBaseUri) {
        this.objectMapper = objectMapper;
        this.problemBaseUri = problemBaseUri;
    }

    @Override
    public void handle(HttpServletRequest request,
                       HttpServletResponse response,
                       AccessDeniedException accessDeniedException) throws IOException {
        log.info("access denied for {} {} [correlationId={}]", request.getMethod(),
                request.getRequestURI(), CorrelationContext.get());

        ApiProblem problem = ApiProblem.of(CommonErrorCode.FORBIDDEN,
                "you do not have permission to perform this operation",
                request.getRequestURI(), CorrelationContext.get(), problemBaseUri);

        response.setStatus(problem.status());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
