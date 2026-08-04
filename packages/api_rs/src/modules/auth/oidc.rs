use std::{error::Error, ops::Deref, time::Duration};

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
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::AuthRedirectResponse;
use crate::config::AuthConfig;
use crate::database::{self, DatabaseConnection, DatabaseError, DatabasePool};
use crate::schema::core;
use crate::util::NonEmpty;

const OIDC_SESSION_KEY: &str = "oidc_session";
const OIDC_STATE_TTL: Duration = Duration::from_secs(600);
#[cfg(test)]
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct OidcSessionState {
    state: String,
    nonce: String,
    pkce_verifier: String,
    return_to: String,
    state_created_at: i64,
}

#[derive(Clone)]
pub struct AuthState {
    oidc: Option<OidcClient>,
    http_client: reqwest::Client,
    post_login_redirect_uri: Url,
    developer_auth_enabled: bool,
    oidc_audience: Option<String>,
    scopes: Vec<Scope>,
}

impl AuthState {
    pub async fn from_config(
        config: &AuthConfig,
    ) -> std::result::Result<Self, Box<dyn Error + Send + Sync>> {
        let post_login_redirect_uri = parse_url(
            &config.oidc_post_login_redirect_uri,
            "OIDC_POST_LOGIN_REDIRECT_URI",
        )?;
        let oidc_audience = config.oidc_audience.clone();
        let http_client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()?;

        let oidc = match (
            config.oidc_issuer_url.as_deref(),
            config.oidc_client_id.as_deref(),
            config.oidc_client_secret.as_deref(),
            config.oidc_redirect_uri.as_deref(),
        ) {
            (None, None, None, None) => None,
            (Some(issuer_url), Some(client_id), Some(client_secret), Some(redirect_uri)) => {
                let issuer = IssuerUrl::new(issuer_url.to_owned())?;
                let provider_metadata =
                    CoreProviderMetadata::discover_async(issuer, &http_client).await?;
                let client = CoreClient::from_provider_metadata(
                    provider_metadata,
                    ClientId::new(client_id.to_owned()),
                    Some(ClientSecret::new(client_secret.to_owned())),
                )
                .set_redirect_uri(RedirectUrl::new(redirect_uri.to_owned())?);
                Some(client)
            }
            _ => unreachable!("OIDC configuration was not validated"),
        };

        Ok(Self {
            oidc,
            http_client,
            post_login_redirect_uri,
            developer_auth_enabled: config.developer_auth_enabled,
            oidc_audience,
            scopes: config.oidc_scopes.iter().cloned().map(Scope::new).collect(),
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
            scopes: vec![
                Scope::new("openid".to_owned()),
                Scope::new("profile".to_owned()),
            ],
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
    let authorization = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scopes(auth.scopes.clone())
        .set_pkce_challenge(pkce_challenge);
    let (authorization_url, csrf_state, nonce) = authorization.url();

    session.renew();
    session.set(
        OIDC_SESSION_KEY,
        OidcSessionState {
            state: csrf_state.secret().to_owned(),
            nonce: nonce.secret().to_owned(),
            pkce_verifier: pkce_verifier.secret().to_owned(),
            return_to: safe_return_to(return_to.as_deref()).unwrap_or_default(),
            state_created_at: chrono::Utc::now().timestamp(),
        },
    );

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
    let oidc_session = take_oidc_session(session);
    let return_to = oidc_session
        .as_ref()
        .map(|oidc_session| oidc_session.return_to.clone());
    let Some(client) = auth.oidc.as_ref() else {
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    };

    let Some(oidc_session) = oidc_session else {
        return Ok(frontend_redirect(auth, return_to.as_deref(), true));
    };

    let valid_timestamp = chrono::DateTime::from_timestamp(oidc_session.state_created_at, 0)
        .is_some_and(|created_at| {
            chrono::Utc::now()
                .signed_duration_since(created_at)
                .to_std()
                .is_ok_and(|age| age <= OIDC_STATE_TTL)
        });
    let valid_state = state
        .as_deref()
        .is_some_and(|actual| oidc_session.state.as_str() == actual);
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
        .set_pkce_verifier(PkceCodeVerifier::new(oidc_session.pkce_verifier))
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
    let nonce = Nonce::new(oidc_session.nonce);
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

    let username = match claims.resolve_username() {
        Some(username) => username.to_owned(),
        None => fetch_userinfo_username(
            client,
            token_response.access_token().to_owned(),
            &subject,
            &auth.http_client,
        )
        .await
        .unwrap_or_else(|| FALLBACK_OIDC_USERNAME.to_owned()),
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

fn parse_url(value: &str, name: &str) -> std::result::Result<Url, Box<dyn Error + Send + Sync>> {
    let url = Url::parse(value).map_err(|error| format!("{name} is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!("{name} must be an absolute HTTP(S) URL").into());
    }
    Ok(url)
}

trait ResolveUsername {
    fn resolve_username(&self) -> Option<&str>;
}

impl ResolveUsername for CoreIdTokenClaims {
    fn resolve_username(&self) -> Option<&str> {
        [
            claim_text(self.preferred_username()),
            localized_claim_text(self.name()),
            localized_claim_text(self.nickname()),
            localized_claim_text(self.given_name()),
            localized_claim_text(self.family_name()),
        ]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
    }
}

impl ResolveUsername for CoreUserInfoClaims {
    fn resolve_username(&self) -> Option<&str> {
        [
            claim_text(self.preferred_username()),
            localized_claim_text(self.name()),
            localized_claim_text(self.nickname()),
            localized_claim_text(self.given_name()),
            localized_claim_text(self.family_name()),
        ]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
    }
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
    claims.resolve_username().map(ToOwned::to_owned)
}

fn claim_text<T>(value: Option<&T>) -> Option<&str>
where
    T: Deref<Target = String>,
{
    value.and_then(|value| value.as_str().non_empty())
}

fn localized_claim_text<T>(value: Option<&LocalizedClaim<T>>) -> Option<&str>
where
    T: Deref<Target = String>,
{
    let value = value?;
    let value = value
        .get(None)
        .or_else(|| value.iter().next().map(|(_, value)| value));
    claim_text(value)
}

fn safe_return_to(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.starts_with('/') && !value.starts_with("//") && !value.contains('\n') {
        Some(value.to_owned())
    } else {
        None
    }
}

fn take_oidc_session(session: &Session) -> Option<OidcSessionState> {
    let value = session.get(OIDC_SESSION_KEY);
    session.remove(OIDC_SESSION_KEY);
    value
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
    use openidconnect::core::{CoreIdTokenClaims, CoreUserInfoClaims};
    use openidconnect::{
        Audience, EndUserFamilyName, EndUserGivenName, EndUserName, EndUserNickname,
        EndUserUsername, IssuerUrl, StandardClaims, SubjectIdentifier,
    };

    use super::ResolveUsername;

    fn id_token_claims() -> CoreIdTokenClaims {
        CoreIdTokenClaims::new(
            IssuerUrl::new("https://issuer.example".to_owned()).expect("valid issuer URL"),
            vec![Audience::new("client".to_owned())],
            chrono::Utc::now(),
            chrono::Utc::now(),
            StandardClaims::new(SubjectIdentifier::new("subject".to_owned())),
            Default::default(),
        )
    }

    fn user_info_claims() -> CoreUserInfoClaims {
        CoreUserInfoClaims::new(
            StandardClaims::new(SubjectIdentifier::new("subject".to_owned())),
            Default::default(),
        )
    }

    #[test]
    fn prefers_username_claims_over_display_names() {
        let claims = id_token_claims()
            .set_preferred_username(Some(EndUserUsername::new(" preferred-user ".to_owned())))
            .set_name(Some(EndUserName::new("Display Name".to_owned()).into()))
            .set_nickname(Some(EndUserNickname::new("nickname".to_owned()).into()))
            .set_given_name(Some(EndUserGivenName::new("Given".to_owned()).into()))
            .set_family_name(Some(EndUserFamilyName::new("Family".to_owned()).into()));

        assert_eq!(claims.resolve_username(), Some("preferred-user"));
    }

    #[test]
    fn uses_the_first_non_empty_name_claim_as_a_fallback() {
        let claims = user_info_claims()
            .set_preferred_username(Some(EndUserUsername::new("   ".to_owned())))
            .set_name(Some(EndUserName::new("   ".to_owned()).into()))
            .set_nickname(Some(EndUserNickname::new("   ".to_owned()).into()))
            .set_given_name(Some(EndUserGivenName::new(" Given ".to_owned()).into()))
            .set_family_name(Some(EndUserFamilyName::new("Family".to_owned()).into()));

        assert_eq!(claims.resolve_username(), Some("Given"));
    }

    #[test]
    fn returns_none_when_no_username_claim_is_available() {
        assert_eq!(user_info_claims().resolve_username(), None);
    }
}
