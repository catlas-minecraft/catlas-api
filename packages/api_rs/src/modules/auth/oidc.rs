use std::{env, error::Error, ops::Deref, time::Duration};

use diesel::{
    Connection, ExpressionMethods, OptionalExtension, QueryDsl, RunQueryDsl, insert_into,
};
use openidconnect::LocalizedClaim;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreIdTokenClaims, CoreProviderMetadata, CoreUserInfoClaims,
};
use openidconnect::reqwest;
use openidconnect::{
    AccessToken, AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken,
    EndpointMaybeSet, EndpointNotSet, EndpointSet, IssuerUrl, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, SubjectIdentifier, TokenResponse as _,
    url::Url,
};
use poem::{Result as PoemResult, http::StatusCode, session::Session};
use poem_openapi::payload::Response;
use uuid::Uuid;

use super::AuthRedirectResponse;
use crate::database::{self, DatabaseConnection, DatabaseError, DatabasePool};
use crate::schema::core;

const OIDC_STATE_KEY: &str = "oidc_state";
const OIDC_NONCE_KEY: &str = "oidc_nonce";
const OIDC_PKCE_VERIFIER_KEY: &str = "oidc_pkce_verifier";
const OIDC_RETURN_TO_KEY: &str = "oidc_return_to";
const OIDC_STATE_CREATED_AT_KEY: &str = "oidc_state_created_at";
const OIDC_STATE_TTL: Duration = Duration::from_secs(600);
const DEFAULT_POST_LOGIN_REDIRECT_URI: &str = "http://127.0.0.1:5173/";
const FALLBACK_OIDC_USERNAME: &str = "OIDC user";

type OidcClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

#[derive(Clone)]
pub struct AuthState {
    oidc: Option<OidcClient>,
    http_client: reqwest::Client,
    post_login_redirect_uri: Url,
    developer_auth_enabled: bool,
    oidc_audience: Option<String>,
}

impl AuthState {
    pub async fn from_env() -> std::result::Result<Self, Box<dyn Error + Send + Sync>> {
        let developer_auth_enabled =
            env_bool("DEV_AUTH_ENABLED")?.unwrap_or(cfg!(debug_assertions));
        let post_login_redirect_uri = parse_url(
            &optional_env("OIDC_POST_LOGIN_REDIRECT_URI")
                .unwrap_or_else(|| DEFAULT_POST_LOGIN_REDIRECT_URI.to_owned()),
            "OIDC_POST_LOGIN_REDIRECT_URI",
        )?;
        let oidc_audience = optional_env("OIDC_AUDIENCE");
        let http_client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()?;

        let oidc_values = [
            optional_env("OIDC_ISSUER_URL"),
            optional_env("OIDC_CLIENT_ID"),
            optional_env("OIDC_CLIENT_SECRET"),
            optional_env("OIDC_REDIRECT_URI"),
        ];
        let oidc = if oidc_values.iter().all(Option::is_none) {
            None
        } else {
            let issuer_url = required_env("OIDC_ISSUER_URL")?;
            let client_id = required_env("OIDC_CLIENT_ID")?;
            let client_secret = required_env("OIDC_CLIENT_SECRET")?;
            let redirect_uri = required_env("OIDC_REDIRECT_URI")?;
            let issuer = IssuerUrl::new(issuer_url)?;
            let provider_metadata =
                CoreProviderMetadata::discover_async(issuer, &http_client).await?;
            let client = CoreClient::from_provider_metadata(
                provider_metadata,
                ClientId::new(client_id),
                Some(ClientSecret::new(client_secret)),
            )
            .set_redirect_uri(RedirectUrl::new(redirect_uri)?);
            Some(client)
        };

        Ok(Self {
            oidc,
            http_client,
            post_login_redirect_uri,
            developer_auth_enabled,
            oidc_audience,
        })
    }

    #[cfg(test)]
    pub(crate) fn for_tests() -> Self {
        Self {
            oidc: None,
            http_client: reqwest::Client::new(),
            post_login_redirect_uri: Url::parse(DEFAULT_POST_LOGIN_REDIRECT_URI)
                .expect("test redirect URI must be valid"),
            developer_auth_enabled: true,
            oidc_audience: None,
        }
    }

    pub(crate) fn oidc_enabled(&self) -> bool {
        self.oidc.is_some()
    }

    pub(crate) fn developer_auth_enabled(&self) -> bool {
        self.developer_auth_enabled
    }
}

pub(crate) async fn begin_login(
    return_to: Option<String>,
    session: &Session,
    auth: &AuthState,
) -> PoemResult<Response<AuthRedirectResponse>> {
    let client = auth
        .oidc
        .as_ref()
        .ok_or_else(|| poem::Error::from_status(StatusCode::NOT_FOUND))?;
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let scopes = configured_scopes();
    let authorization = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scopes(scopes)
        .set_pkce_challenge(pkce_challenge);
    let (authorization_url, csrf_state, nonce) = authorization.url();

    session.renew();
    session.set(OIDC_STATE_KEY, csrf_state.secret().to_owned());
    session.set(OIDC_NONCE_KEY, nonce.secret().to_owned());
    session.set(OIDC_PKCE_VERIFIER_KEY, pkce_verifier.secret().to_owned());
    session.set(
        OIDC_RETURN_TO_KEY,
        safe_return_to(return_to.as_deref()).unwrap_or_default(),
    );
    session.set(OIDC_STATE_CREATED_AT_KEY, chrono::Utc::now().timestamp());

    Ok(redirect_response(authorization_url.to_string()))
}

pub(crate) async fn finish_callback(
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    session: &Session,
    auth: &AuthState,
    pool: &DatabasePool,
) -> PoemResult<Response<AuthRedirectResponse>> {
    let return_to = take_return_to(session);
    let Some(client) = auth.oidc.as_ref() else {
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    };

    let expected_state: Option<String> = session.get(OIDC_STATE_KEY);
    let expected_nonce: Option<String> = session.get(OIDC_NONCE_KEY);
    let pkce_verifier: Option<String> = session.get(OIDC_PKCE_VERIFIER_KEY);
    let state_created_at: Option<i64> = session.get(OIDC_STATE_CREATED_AT_KEY);
    clear_oidc_state(session);

    let valid_timestamp = state_created_at
        .and_then(|timestamp| chrono::DateTime::from_timestamp(timestamp, 0))
        .is_some_and(|created_at| {
            chrono::Utc::now()
                .signed_duration_since(created_at)
                .to_std()
                .is_ok_and(|age| age <= OIDC_STATE_TTL)
        });
    let valid_state = expected_state
        .as_deref()
        .zip(state.as_deref())
        .is_some_and(|(expected, actual)| expected == actual);
    let Some(nonce) = expected_nonce else {
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    };
    let Some(verifier) = pkce_verifier else {
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    };
    if !valid_timestamp || !valid_state || error.is_some() {
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    }
    let Some(code) = code else {
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    };

    let token_request = match client.exchange_code(AuthorizationCode::new(code)) {
        Ok(request) => request,
        Err(error) => {
            tracing::warn!(error = %error, "OIDC token exchange configuration failed");
            return Ok(frontend_redirect(auth, return_to.as_deref(), true));
        }
    };
    let token_response = match token_request
        .set_pkce_verifier(PkceCodeVerifier::new(verifier))
        .request_async(&auth.http_client)
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = %error, "OIDC token exchange failed");
            return Ok(frontend_redirect(auth, return_to.as_deref(), true));
        }
    };
    let Some(id_token) = token_response.id_token() else {
        tracing::warn!("OIDC provider did not return an ID token");
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    };
    let id_token_verifier = match auth.oidc_audience.as_deref() {
        Some(trusted_audience) => {
            let trusted_audience = trusted_audience.to_owned();
            client
                .id_token_verifier()
                .set_other_audience_verifier_fn(move |audience| {
                    audience.as_str() == trusted_audience
                })
        }
        None => client.id_token_verifier(),
    };
    let nonce = Nonce::new(nonce);
    let claims = match id_token.claims(&id_token_verifier, &nonce) {
        Ok(claims) => claims,
        Err(error) => {
            tracing::warn!(error = %error, "OIDC ID token verification failed");
            return Ok(frontend_redirect(auth, return_to.as_deref(), true));
        }
    };
    if let Err(error) =
        verify_access_token_hash(&token_response, id_token, claims, &id_token_verifier)
    {
        tracing::warn!(error = %error, "OIDC access token hash verification failed");
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    }

    let issuer = claims.issuer().as_str().to_owned();
    let subject = claims.subject().as_str().to_owned();
    let username = oidc_username(claims);
    let username = if username == FALLBACK_OIDC_USERNAME {
        fetch_userinfo_username(
            client,
            token_response.access_token().to_owned(),
            &subject,
            &auth.http_client,
        )
        .await
        .unwrap_or(username)
    } else {
        username
    };
    let user = database::blocking(pool, move |connection| {
        provision_oidc_user(connection, &issuer, &subject, &username)
    })
    .await
    .map_err(crate::modules::common::support::db_error)?;

    session.renew();
    session.set("user_id", user.0);
    Ok(frontend_redirect(auth, return_to.as_deref(), false))
}

fn required_env(name: &str) -> std::result::Result<String, Box<dyn Error + Send + Sync>> {
    optional_env(name).ok_or_else(|| format!("{name} must be set when OIDC is enabled").into())
}

fn optional_env(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.trim().is_empty())
}

fn parse_url(value: &str, name: &str) -> std::result::Result<Url, Box<dyn Error + Send + Sync>> {
    let url = Url::parse(value).map_err(|error| format!("{name} is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!("{name} must be an absolute HTTP(S) URL").into());
    }
    Ok(url)
}

fn env_bool(name: &str) -> std::result::Result<Option<bool>, Box<dyn Error + Send + Sync>> {
    let Ok(value) = env::var(name) else {
        return Ok(None);
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" => Ok(Some(true)),
        "false" | "0" | "no" => Ok(Some(false)),
        _ => Err(format!("{name} must be true or false").into()),
    }
}

fn configured_scopes() -> Vec<Scope> {
    let configured = optional_env("OIDC_SCOPES").unwrap_or_else(|| "openid profile".to_owned());
    let mut scopes = configured
        .split_whitespace()
        .filter(|scope| !scope.is_empty())
        .map(|scope| Scope::new(scope.to_owned()))
        .collect::<Vec<_>>();
    if !scopes.iter().any(|scope| scope.as_str() == "openid") {
        scopes.insert(0, Scope::new("openid".to_owned()));
    }
    scopes
}

fn oidc_username(claims: &CoreIdTokenClaims) -> String {
    username_from_claims(
        claim_text(claims.preferred_username()),
        localized_claim_text(claims.name()),
        localized_claim_text(claims.nickname()),
        localized_claim_text(claims.given_name()),
        localized_claim_text(claims.family_name()),
    )
    .unwrap_or_else(|| FALLBACK_OIDC_USERNAME.to_owned())
}

fn userinfo_username_from_claims(claims: &CoreUserInfoClaims) -> Option<String> {
    username_from_claims(
        claim_text(claims.preferred_username()),
        localized_claim_text(claims.name()),
        localized_claim_text(claims.nickname()),
        localized_claim_text(claims.given_name()),
        localized_claim_text(claims.family_name()),
    )
}

fn username_from_claims(
    preferred_username: Option<String>,
    name: Option<String>,
    nickname: Option<String>,
    given_name: Option<String>,
    family_name: Option<String>,
) -> Option<String> {
    preferred_username
        .or(name)
        .or(nickname)
        .or_else(|| match (given_name, family_name) {
            (Some(given), Some(family)) => Some(format!("{given} {family}")),
            (Some(given), None) => Some(given),
            (None, Some(family)) => Some(family),
            (None, None) => None,
        })
}

async fn fetch_userinfo_username(
    client: &OidcClient,
    access_token: AccessToken,
    subject: &str,
    http_client: &reqwest::Client,
) -> Option<String> {
    let request = client
        .user_info(
            access_token,
            Some(SubjectIdentifier::new(subject.to_owned())),
        )
        .ok()?;
    let claims: CoreUserInfoClaims = request.request_async(http_client).await.ok()?;
    userinfo_username_from_claims(&claims)
}

fn claim_text<T>(value: Option<&T>) -> Option<String>
where
    T: Deref<Target = String>,
{
    non_empty(value.map(|value| value.as_str().to_owned()))
}

fn localized_claim_text<T>(value: Option<&LocalizedClaim<T>>) -> Option<String>
where
    T: Deref<Target = String>,
{
    let value = value?;
    let value = value
        .get(None)
        .or_else(|| value.iter().next().map(|(_, value)| value));
    claim_text(value)
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

fn safe_return_to(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.starts_with('/') && !value.starts_with("//") && !value.contains('\n') {
        Some(value.to_owned())
    } else {
        None
    }
}

fn take_return_to(session: &Session) -> Option<String> {
    let value = session.get(OIDC_RETURN_TO_KEY);
    session.remove(OIDC_RETURN_TO_KEY);
    value
}

fn clear_oidc_state(session: &Session) {
    session.remove(OIDC_STATE_KEY);
    session.remove(OIDC_NONCE_KEY);
    session.remove(OIDC_PKCE_VERIFIER_KEY);
    session.remove(OIDC_STATE_CREATED_AT_KEY);
}

fn redirect_response(location: String) -> Response<AuthRedirectResponse> {
    Response::new(AuthRedirectResponse::Redirect)
        .status(StatusCode::SEE_OTHER)
        .header("Location", location)
}

fn frontend_redirect(
    auth: &AuthState,
    return_to: Option<&str>,
    error: bool,
) -> Response<AuthRedirectResponse> {
    let mut redirect = auth.post_login_redirect_uri.clone();
    if let Some(return_to) = safe_return_to(return_to) {
        redirect.set_path(&return_to);
        redirect.set_query(None);
        redirect.set_fragment(None);
    }
    if error {
        let mut pairs = redirect.query_pairs_mut();
        pairs.append_pair("authError", "oidc_login_failed");
    }
    redirect_response(redirect.to_string())
}

fn verify_access_token_hash<TR>(
    token_response: &TR,
    id_token: &openidconnect::core::CoreIdToken,
    claims: &CoreIdTokenClaims,
    verifier: &openidconnect::core::CoreIdTokenVerifier<'_>,
) -> std::result::Result<(), Box<dyn Error + Send + Sync>>
where
    TR: OAuth2TokenResponse,
{
    let Some(expected) = claims.access_token_hash() else {
        return Ok(());
    };
    let actual = AccessTokenHash::from_token(
        token_response.access_token(),
        id_token.signing_alg()?,
        id_token.signing_key(verifier)?,
    )?;
    if actual != *expected {
        return Err("OIDC access token hash mismatch".into());
    }
    Ok(())
}

pub(crate) fn provision_oidc_user(
    connection: &mut DatabaseConnection,
    issuer: &str,
    subject: &str,
    username: &str,
) -> std::result::Result<(i64, String, String), DatabaseError> {
    connection.transaction::<(i64, String, String), DatabaseError, _>(|connection| {
        let existing_user_id = core::oidc_user_identities::table
            .filter(core::oidc_user_identities::issuer.eq(issuer))
            .filter(core::oidc_user_identities::subject.eq(subject))
            .select(core::oidc_user_identities::user_id)
            .first::<i64>(connection)
            .optional()?;

        if let Some(user_id) = existing_user_id {
            return diesel::update(core::users::table.filter(core::users::id.eq(user_id)))
                .set(core::users::username.eq(username))
                .returning((core::users::id, core::users::user_id, core::users::username))
                .get_result::<(i64, String, String)>(connection)
                .map_err(Into::into);
        }

        let public_user_id = format!("oidc_{}", Uuid::new_v4());
        let user = insert_into(core::users::table)
            .values((
                core::users::user_id.eq(&public_user_id),
                core::users::username.eq(username),
            ))
            .returning((core::users::id, core::users::user_id, core::users::username))
            .get_result::<(i64, String, String)>(connection)?;

        let inserted = insert_into(core::oidc_user_identities::table)
            .values((
                core::oidc_user_identities::user_id.eq(user.0),
                core::oidc_user_identities::issuer.eq(issuer),
                core::oidc_user_identities::subject.eq(subject),
            ))
            .on_conflict((
                core::oidc_user_identities::issuer,
                core::oidc_user_identities::subject,
            ))
            .do_nothing()
            .execute(connection)?;

        if inserted == 1 {
            return Ok(user);
        }

        let existing_user_id = core::oidc_user_identities::table
            .filter(core::oidc_user_identities::issuer.eq(issuer))
            .filter(core::oidc_user_identities::subject.eq(subject))
            .select(core::oidc_user_identities::user_id)
            .first::<i64>(connection)?;
        diesel::delete(core::users::table.filter(core::users::id.eq(user.0)))
            .execute(connection)?;
        core::users::table
            .filter(core::users::id.eq(existing_user_id))
            .select((core::users::id, core::users::user_id, core::users::username))
            .first::<(i64, String, String)>(connection)
            .map_err(Into::into)
    })
}

#[cfg(test)]
mod tests {
    use super::username_from_claims;

    #[test]
    fn prefers_username_claims_over_display_names() {
        assert_eq!(
            username_from_claims(
                Some("preferred-user".to_owned()),
                Some("Display Name".to_owned()),
                Some("nickname".to_owned()),
                Some("Given".to_owned()),
                Some("Family".to_owned()),
            ),
            Some("preferred-user".to_owned())
        );
    }

    #[test]
    fn combines_given_and_family_names_as_a_fallback() {
        assert_eq!(
            username_from_claims(
                None,
                None,
                None,
                Some("Given".to_owned()),
                Some("Family".to_owned())
            ),
            Some("Given Family".to_owned())
        );
    }
}
