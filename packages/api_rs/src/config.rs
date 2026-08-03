use std::{collections::HashMap, error::Error, sync::Arc, time::Duration};

use config::{Config as ConfigSource, Environment};
use poem::http::Uri;
use serde::Deserialize;

pub type ConfigError = Box<dyn Error + Send + Sync>;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: &str = "3000";
const DEFAULT_POST_LOGIN_REDIRECT_URI: &str = "http://127.0.0.1:5173/";
const DEFAULT_OTLP_ENDPOINT: &str = "http://localhost:4318";
const DEFAULT_OTLP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default, Deserialize)]
#[serde(default)]
struct RawEnv {
    database_url: Option<String>,
    #[cfg(test)]
    test_database_url: Option<String>,
    host: Option<String>,
    port: Option<String>,
    cookie_secure: Option<String>,
    dev_auth_enabled: Option<String>,
    oidc_issuer_url: Option<String>,
    oidc_client_id: Option<String>,
    oidc_client_secret: Option<String>,
    oidc_redirect_uri: Option<String>,
    oidc_audience: Option<String>,
    oidc_post_login_redirect_uri: Option<String>,
    oidc_scopes: Option<String>,
    rust_log: Option<String>,
    otel_enabled: Option<String>,
    otel_service_name: Option<String>,
    otel_exporter_otlp_endpoint: Option<String>,
    otel_exporter_otlp_traces_endpoint: Option<String>,
    otel_exporter_otlp_timeout: Option<String>,
    otel_exporter_otlp_traces_timeout: Option<String>,
    otel_exporter_otlp_compression: Option<String>,
    otel_exporter_otlp_traces_compression: Option<String>,
    otel_exporter_otlp_headers: Option<String>,
    otel_exporter_otlp_traces_headers: Option<String>,
}

#[derive(Clone)]
pub struct Config {
    inner: Arc<ConfigInner>,
}

struct ConfigInner {
    database: DatabaseConfig,
    host: String,
    port: String,
    cookie_secure: bool,
    auth: AuthConfig,
    telemetry: TelemetryConfig,
}

pub struct DatabaseConfig {
    database_url: String,
}

pub struct AuthConfig {
    pub(crate) developer_auth_enabled: bool,
    pub(crate) oidc_issuer_url: Option<String>,
    pub(crate) oidc_client_id: Option<String>,
    pub(crate) oidc_client_secret: Option<String>,
    pub(crate) oidc_redirect_uri: Option<String>,
    pub(crate) oidc_audience: Option<String>,
    pub(crate) oidc_post_login_redirect_uri: String,
    pub(crate) oidc_scopes: Vec<String>,
}

pub struct TelemetryConfig {
    enabled: bool,
    service_name: String,
    log_filter: Option<String>,
    otlp_endpoint: String,
    otlp_timeout: Duration,
    otlp_compression: Option<String>,
    otlp_headers: HashMap<String, String>,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let raw = load_env()?;
        let database = DatabaseConfig::from_raw(&raw)?;
        let developer_auth_enabled = parse_bool(raw.dev_auth_enabled.as_ref(), "DEV_AUTH_ENABLED")?
            .unwrap_or(cfg!(debug_assertions));
        let auth = AuthConfig::from_raw(&raw, developer_auth_enabled)?;

        Ok(Self {
            inner: Arc::new(ConfigInner {
                database,
                host: optional_value(raw.host.as_ref()).unwrap_or_else(|| DEFAULT_HOST.to_owned()),
                port: optional_value(raw.port.as_ref()).unwrap_or_else(|| DEFAULT_PORT.to_owned()),
                cookie_secure: raw
                    .cookie_secure
                    .as_deref()
                    .is_some_and(|value| value.eq_ignore_ascii_case("true")),
                auth,
                telemetry: TelemetryConfig::from_raw(&raw),
            }),
        })
    }

    pub fn database_url(&self) -> &str {
        &self.inner.database.database_url
    }

    pub fn host(&self) -> &str {
        &self.inner.host
    }

    pub fn port(&self) -> &str {
        &self.inner.port
    }

    pub fn cookie_secure(&self) -> bool {
        self.inner.cookie_secure
    }

    pub fn auth(&self) -> &AuthConfig {
        &self.inner.auth
    }

    pub fn telemetry(&self) -> &TelemetryConfig {
        &self.inner.telemetry
    }
}

impl DatabaseConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_raw(&load_env()?)
    }

    fn from_raw(raw: &RawEnv) -> Result<Self, ConfigError> {
        Ok(Self {
            database_url: required_value(
                optional_value(raw.database_url.as_ref()),
                "DATABASE_URL",
            )?,
        })
    }

    pub fn url(&self) -> &str {
        &self.database_url
    }
}

impl AuthConfig {
    fn from_raw(raw: &RawEnv, developer_auth_enabled: bool) -> Result<Self, ConfigError> {
        let oidc_values = [
            optional_value(raw.oidc_issuer_url.as_ref()),
            optional_value(raw.oidc_client_id.as_ref()),
            optional_value(raw.oidc_client_secret.as_ref()),
            optional_value(raw.oidc_redirect_uri.as_ref()),
        ];
        let (oidc_issuer_url, oidc_client_id, oidc_client_secret, oidc_redirect_uri) =
            if oidc_values.iter().all(Option::is_none) {
                (None, None, None, None)
            } else {
                (
                    Some(required_value(oidc_values[0].clone(), "OIDC_ISSUER_URL")?),
                    Some(required_value(oidc_values[1].clone(), "OIDC_CLIENT_ID")?),
                    Some(required_value(
                        oidc_values[2].clone(),
                        "OIDC_CLIENT_SECRET",
                    )?),
                    Some(required_value(oidc_values[3].clone(), "OIDC_REDIRECT_URI")?),
                )
            };

        let scopes =
            optional_value(raw.oidc_scopes.as_ref()).unwrap_or_else(|| "openid profile".to_owned());

        Ok(Self {
            developer_auth_enabled,
            oidc_issuer_url,
            oidc_client_id,
            oidc_client_secret,
            oidc_redirect_uri,
            oidc_audience: optional_value(raw.oidc_audience.as_ref()),
            oidc_post_login_redirect_uri: optional_value(raw.oidc_post_login_redirect_uri.as_ref())
                .unwrap_or_else(|| DEFAULT_POST_LOGIN_REDIRECT_URI.to_owned()),
            oidc_scopes: parse_scopes(&scopes),
        })
    }
}

impl TelemetryConfig {
    fn from_raw(raw: &RawEnv) -> Self {
        let generic_endpoint = optional_value(raw.otel_exporter_otlp_endpoint.as_ref());
        let trace_endpoint = optional_value(raw.otel_exporter_otlp_traces_endpoint.as_ref());
        let otlp_endpoint =
            resolve_otlp_endpoint(trace_endpoint.as_deref(), generic_endpoint.as_deref());
        let trace_timeout = optional_value(raw.otel_exporter_otlp_traces_timeout.as_ref());
        let generic_timeout = optional_value(raw.otel_exporter_otlp_timeout.as_ref());
        let otlp_timeout =
            resolve_otlp_timeout(trace_timeout.as_deref(), generic_timeout.as_deref());
        let otlp_compression = optional_value(raw.otel_exporter_otlp_traces_compression.as_ref())
            .or_else(|| optional_value(raw.otel_exporter_otlp_compression.as_ref()));
        let headers = optional_value(raw.otel_exporter_otlp_traces_headers.as_ref())
            .or_else(|| optional_value(raw.otel_exporter_otlp_headers.as_ref()))
            .map(|value| parse_headers(&value))
            .unwrap_or_default();

        Self {
            enabled: env_flag(raw.otel_enabled.as_ref()),
            service_name: optional_value(raw.otel_service_name.as_ref())
                .unwrap_or_else(|| "catlas-api-rs".to_owned()),
            log_filter: optional_value(raw.rust_log.as_ref()),
            otlp_endpoint,
            otlp_timeout,
            otlp_compression,
            otlp_headers: headers,
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn service_name(&self) -> &str {
        &self.service_name
    }

    pub fn log_filter(&self) -> Option<&str> {
        self.log_filter.as_deref()
    }

    pub fn otlp_endpoint(&self) -> &str {
        &self.otlp_endpoint
    }

    pub fn otlp_timeout(&self) -> Duration {
        self.otlp_timeout
    }

    pub fn otlp_compression(&self) -> Option<&str> {
        self.otlp_compression.as_deref()
    }

    pub fn otlp_headers(&self) -> &HashMap<String, String> {
        &self.otlp_headers
    }
}

fn load_env() -> Result<RawEnv, ConfigError> {
    ConfigSource::builder()
        .add_source(Environment::default().separator(""))
        .build()?
        .try_deserialize::<RawEnv>()
        .map_err(Into::into)
}

fn optional_value(value: Option<&String>) -> Option<String> {
    value.cloned().filter(|value| !value.trim().is_empty())
}

fn required_value(value: Option<String>, name: &str) -> Result<String, ConfigError> {
    value.ok_or_else(|| format!("{name} must be set").into())
}

fn parse_bool(value: Option<&String>, name: &str) -> Result<Option<bool>, ConfigError> {
    let Some(value) = value else {
        return Ok(None);
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" => Ok(Some(true)),
        "false" | "0" | "no" => Ok(Some(false)),
        _ => Err(format!("{name} must be true or false").into()),
    }
}

fn env_flag(value: Option<&String>) -> bool {
    value
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

fn parse_scopes(value: &str) -> Vec<String> {
    let mut scopes = value
        .split_whitespace()
        .filter(|scope| !scope.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if !scopes.iter().any(|scope| scope == "openid") {
        scopes.insert(0, "openid".to_owned());
    }
    scopes
}

fn resolve_otlp_endpoint(trace_endpoint: Option<&str>, generic_endpoint: Option<&str>) -> String {
    trace_endpoint
        .map(str::to_owned)
        .and_then(valid_endpoint)
        .or_else(|| {
            let endpoint = generic_endpoint.unwrap_or(DEFAULT_OTLP_ENDPOINT);
            valid_endpoint(append_trace_path(endpoint))
        })
        .unwrap_or_else(|| append_trace_path(DEFAULT_OTLP_ENDPOINT))
}

fn valid_endpoint(endpoint: String) -> Option<String> {
    let uri = endpoint.parse::<Uri>().ok()?;
    if uri.authority().is_none()
        || !uri
            .scheme_str()
            .is_some_and(|scheme| matches!(scheme, "http" | "https"))
    {
        return None;
    }
    Some(endpoint)
}

fn append_trace_path(endpoint: &str) -> String {
    format!("{}/v1/traces", endpoint.trim_end_matches('/'))
}

fn resolve_otlp_timeout(trace_timeout: Option<&str>, generic_timeout: Option<&str>) -> Duration {
    trace_timeout
        .and_then(parse_timeout)
        .or_else(|| generic_timeout.and_then(parse_timeout))
        .unwrap_or(DEFAULT_OTLP_TIMEOUT)
}

fn parse_timeout(value: &str) -> Option<Duration> {
    value.parse::<u64>().ok().map(Duration::from_millis)
}

fn parse_headers(value: &str) -> HashMap<String, String> {
    value
        .split(',')
        .filter_map(|header| header.split_once('='))
        .map(|(name, value)| (name.trim().to_owned(), value.trim().to_owned()))
        .collect()
}

#[cfg(test)]
pub(crate) fn test_database_url() -> String {
    load_env()
        .and_then(|raw| {
            required_value(
                optional_value(raw.test_database_url.as_ref()),
                "TEST_DATABASE_URL",
            )
        })
        .expect("TEST_DATABASE_URL must be set")
}
