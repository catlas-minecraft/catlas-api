use opentelemetry::{global, trace::TracerProvider as _};
use opentelemetry_otlp::{Protocol, SpanExporter, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::{
    Resource,
    propagation::TraceContextPropagator,
    runtime,
    trace::{SdkTracer, SdkTracerProvider, span_processor_with_async_runtime::BatchSpanProcessor},
};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

use catlas_api::config::TelemetryConfig;

pub struct Telemetry {
    tracer_provider: SdkTracerProvider,
}

impl Telemetry {
    pub fn init(
        config: &TelemetryConfig,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let filter = config
            .log_filter()
            .and_then(|value| EnvFilter::try_new(value).ok())
            .unwrap_or_else(|| EnvFilter::new("info"));
        global::set_text_map_propagator(TraceContextPropagator::new());

        if config.enabled() {
            if config.otlp_compression().is_some() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "OTLP HTTP compression is not supported by opentelemetry-otlp 0.30",
                )
                .into());
            }

            let exporter_builder = SpanExporter::builder()
                .with_http()
                .with_endpoint(config.otlp_endpoint())
                .with_protocol(Protocol::HttpBinary)
                .with_timeout(config.otlp_timeout())
                .with_headers(config.otlp_headers().clone());
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
                .with(tracing_opentelemetry::layer().with_tracer(tracer))
                .try_init()?;

            Ok(Self { tracer_provider })
        } else {
            let tracer_provider = SdkTracerProvider::builder().build();
            tracing_subscriber::registry()
                .with(tracing_subscriber::fmt::layer())
                .with(filter)
                .try_init()?;

            Ok(Self { tracer_provider })
        }
    }

    pub fn tracer(&self) -> SdkTracer {
        self.tracer_provider.tracer("catlas-api-rs")
    }

    pub fn shutdown(self) {
        if let Err(error) = self.tracer_provider.shutdown() {
            eprintln!("failed to shut down OpenTelemetry: {error}");
        }
    }
}
