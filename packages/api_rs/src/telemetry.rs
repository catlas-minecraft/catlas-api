use std::env;

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::SpanExporter;
use opentelemetry_sdk::{
    Resource, runtime,
    trace::{SdkTracerProvider, span_processor_with_async_runtime::BatchSpanProcessor},
};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

pub struct Telemetry {
    tracer_provider: Option<SdkTracerProvider>,
}

impl Telemetry {
    pub fn init() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

        if otel_enabled() {
            let exporter = SpanExporter::builder().with_http().build()?;
            let resource = Resource::builder()
                .with_service_name(
                    env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "catlas-api-rs".into()),
                )
                .build();
            let batch_processor = BatchSpanProcessor::builder(exporter, runtime::Tokio).build();
            let tracer_provider = SdkTracerProvider::builder()
                .with_resource(resource)
                .with_span_processor(batch_processor)
                .build();
            let tracer = tracer_provider.tracer("catlas-api-rs");

            tracing_subscriber::registry()
                .with(tracing_subscriber::fmt::layer())
                .with(filter)
                .with(
                    tracing_opentelemetry::layer()
                        .with_tracer(tracer)
                        // Resolve the route template before starting the OTel span.
                        .with_context_activation(false),
                )
                .try_init()?;

            Ok(Self {
                tracer_provider: Some(tracer_provider),
            })
        } else {
            tracing_subscriber::registry()
                .with(tracing_subscriber::fmt::layer())
                .with(filter)
                .try_init()?;

            Ok(Self {
                tracer_provider: None,
            })
        }
    }

    pub fn shutdown(self) {
        if let Some(tracer_provider) = self.tracer_provider
            && let Err(error) = tracer_provider.shutdown()
        {
            eprintln!("failed to shut down OpenTelemetry: {error}");
        }
    }
}

fn otel_enabled() -> bool {
    env::var("OTEL_ENABLED")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}
