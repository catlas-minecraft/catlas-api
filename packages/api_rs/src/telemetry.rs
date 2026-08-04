use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{Compression, Protocol, SpanExporter, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::{
    Resource, runtime,
    trace::{SdkTracerProvider, span_processor_with_async_runtime::BatchSpanProcessor},
};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

use catlas_api::config::TelemetryConfig;

pub struct Telemetry {
    tracer_provider: Option<SdkTracerProvider>,
}

impl Telemetry {
    pub fn init(
        config: &TelemetryConfig,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let filter = config
            .log_filter()
            .and_then(|value| EnvFilter::try_new(value).ok())
            .unwrap_or_else(|| EnvFilter::new("info"));

        if config.enabled() {
            let exporter_builder = SpanExporter::builder()
                .with_http()
                .with_endpoint(config.otlp_endpoint())
                .with_protocol(Protocol::HttpBinary)
                .with_timeout(config.otlp_timeout())
                .with_headers(config.otlp_headers().clone());
            let exporter_builder = if let Some(compression) = config.otlp_compression() {
                exporter_builder.with_compression(compression.parse::<Compression>()?)
            } else {
                exporter_builder
            };
            let exporter = exporter_builder.build()?;
            let resource = Resource::builder()
                .with_service_name(config.service_name().to_owned())
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
