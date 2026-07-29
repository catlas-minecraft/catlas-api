use std::time::Instant;

use poem::{
    Endpoint, FromRequest, IntoResponse, Middleware, PathPattern, Request, Response, Result,
    web::RealIp,
};
use tracing::{Instrument, Level};

#[derive(Default)]
pub struct RequestTracing;

impl<E: Endpoint> Middleware<E> for RequestTracing {
    type Output = RequestTracingEndpoint<E>;

    fn transform(&self, ep: E) -> Self::Output {
        RequestTracingEndpoint { inner: ep }
    }
}

pub struct RequestTracingEndpoint<E> {
    inner: E,
}

impl<E: Endpoint> Endpoint for RequestTracingEndpoint<E> {
    type Output = Response;

    async fn call(&self, req: Request) -> Result<Self::Output> {
        let remote_addr = RealIp::from_request_without_body(&req)
            .await
            .ok()
            .and_then(|real_ip| real_ip.0)
            .map(|addr| addr.to_string())
            .unwrap_or_else(|| req.remote_addr().to_string());
        let method = req.method().to_string();
        let fallback_span_name = format!("{method} {}", req.original_uri().path());

        let span = tracing::span!(
            target: module_path!(),
            Level::INFO,
            "request",
            otel.name = fallback_span_name.as_str(),
            otel.kind = "server",
            remote_addr = %remote_addr,
            version = ?req.version(),
            method = %method,
            uri = %req.original_uri(),
        );
        let span_for_name = span.clone();

        async move {
            let now = Instant::now();
            let res = self.inner.call(req).await;
            let duration = now.elapsed();

            match res {
                Ok(resp) => {
                    let resp = resp.into_response();
                    record_span_name(
                        &span_for_name,
                        &method,
                        &fallback_span_name,
                        resp.data::<PathPattern>(),
                    );
                    tracing::info!(
                        status = %resp.status(),
                        duration = ?duration,
                        "response"
                    );
                    Ok(resp)
                }
                Err(err) => {
                    record_span_name(
                        &span_for_name,
                        &method,
                        &fallback_span_name,
                        err.data::<PathPattern>(),
                    );
                    tracing::info!(
                        status = %err.status(),
                        error = %err,
                        duration = ?duration,
                        "error"
                    );
                    let status = err.status();
                    let code = match status.as_u16() {
                        400 => "validation",
                        401 => "unauthorized",
                        403 => "forbidden",
                        404 => "not_found",
                        409 => "version_conflict",
                        422 => "invalid_geometry_state",
                        _ => "unknown",
                    };
                    let body = serde_json::json!({
                        "code": code,
                        "message": if code == "unknown" { "request failed" } else { code },
                    });
                    Ok(Response::builder()
                        .status(status)
                        .content_type("application/json")
                        .body(body.to_string()))
                }
            }
        }
        .instrument(span)
        .await
    }
}

fn record_span_name(
    span: &tracing::Span,
    method: &str,
    fallback_span_name: &str,
    path_pattern: Option<&PathPattern>,
) {
    let span_name = path_pattern.map_or_else(
        || fallback_span_name.to_owned(),
        |path_pattern| format!("{method} {}", path_pattern.0),
    );
    span.record("otel.name", span_name.as_str());
}

#[cfg(test)]
mod tests {
    use opentelemetry::trace::TracerProvider as _;
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use poem::{Endpoint, EndpointExt, Request, Route, endpoint::make_sync};
    use tracing_subscriber::layer::SubscriberExt;

    use super::RequestTracing;

    #[tokio::test]
    async fn uses_the_route_template_as_the_span_name() {
        let exporter = InMemorySpanExporter::default();
        let tracer_provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let tracer = tracer_provider.tracer("test");
        let subscriber = tracing_subscriber::registry().with(
            tracing_opentelemetry::layer()
                .with_tracer(tracer)
                .with_context_activation(false),
        );
        let _subscriber = tracing::subscriber::set_default(subscriber);
        let app = Route::new()
            .nest("/api", Route::new().at("/users/:id", make_sync(|_| "ok")))
            .with(RequestTracing);

        let response = app
            .get_response(
                Request::builder()
                    .method(poem::http::Method::GET)
                    .uri(poem::http::Uri::from_static("/api/users/42"))
                    .finish(),
            )
            .await;

        assert_eq!(response.status(), poem::http::StatusCode::OK);
        tracer_provider.force_flush().unwrap();

        let spans = exporter.get_finished_spans().unwrap();
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].name.as_ref(), "GET /api/users/:id");
    }
}
