use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri_plugin_opener::OpenerExt;
use tokio::{net::TcpListener, sync::oneshot};

static SIGNING_IN: AtomicBool = AtomicBool::new(false);
const LOOPBACK_ADDRESS: &str = "127.0.0.1:0";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Development,
    Production,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FirebaseConfig {
    api_key: String,
    auth_domain: String,
    project_id: String,
    app_id: String,
    storage_bucket: String,
}

#[derive(Clone)]
struct Relay {
    host: String,
    nonce: String,
    html: String,
    csp: String,
    sender: Arc<Mutex<Option<oneshot::Sender<String>>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Completion {
    nonce: String,
    id_token: String,
}

fn host_matches(headers: &HeaderMap, host: &str) -> bool {
    headers.get("host").and_then(|h| h.to_str().ok()) == Some(host)
}

async fn page(State(relay): State<Relay>, headers: HeaderMap) -> Response {
    if !host_matches(&headers, &relay.host) {
        return StatusCode::FORBIDDEN.into_response();
    }
    (
        [
            ("cache-control", "no-store"),
            ("referrer-policy", "no-referrer"),
            ("x-frame-options", "DENY"),
            ("content-security-policy", relay.csp.as_str()),
        ],
        Html(relay.html),
    )
        .into_response()
}

async fn complete(
    State(relay): State<Relay>,
    headers: HeaderMap,
    Json(value): Json<Completion>,
) -> StatusCode {
    let origin = format!("http://{}", relay.host);
    if !host_matches(&headers, &relay.host)
        || headers.get("origin").and_then(|v| v.to_str().ok()) != Some(origin.as_str())
        || value.nonce != relay.nonce
        || value.id_token.len() < 40
        || value.id_token.len() > 12000
    {
        return StatusCode::FORBIDDEN;
    }
    // One callback only. Firebase verifies the Google credential before any Account access.
    let Ok(mut sender) = relay.sender.lock() else {
        return StatusCode::INTERNAL_SERVER_ERROR;
    };
    match sender.take() {
        Some(sender) => {
            if sender.send(value.id_token).is_ok() {
                StatusCode::NO_CONTENT
            } else {
                StatusCode::GONE
            }
        }
        _ => StatusCode::GONE,
    }
}

fn router(relay: Relay) -> Router {
    Router::new()
        .route("/", get(page))
        .route("/complete", post(complete))
        .layer(DefaultBodyLimit::max(16000))
        .with_state(relay)
}

struct SignInGuard;
impl SignInGuard {
    fn begin() -> Result<Self, String> {
        SIGNING_IN
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Self)
            .map_err(|_| "A browser sign-in is already running.".into())
    }
}
impl Drop for SignInGuard {
    fn drop(&mut self) {
        SIGNING_IN.store(false, Ordering::SeqCst);
    }
}

fn valid_host(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value == value.to_ascii_lowercase()
        && !value.contains("://")
        && !value.contains('/')
        && !value.contains(':')
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

fn unsafe_production_host(value: &str) -> bool {
    value == "localhost"
        || value.starts_with("127.")
        || value == "::1"
        || value.contains("emulator")
        || value.ends_with(".local")
}

fn validate_config(
    environment: Environment,
    config: &FirebaseConfig,
    release: bool,
) -> Result<(), String> {
    if config.api_key.len() < 24
        || config.api_key.len() > 512
        || !config.api_key.starts_with("AIza")
        || config
            .api_key
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        || config.app_id.len() < 10
        || config.app_id.len() > 512
        || config
            .app_id
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        || !valid_host(&config.auth_domain)
        || !valid_host(&config.storage_bucket)
        || config.project_id.len() < 5
        || config.project_id.len() > 30
        || !config
            .project_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Firebase authentication configuration is invalid.".into());
    }
    match environment {
        Environment::Development => {
            if release {
                return Err("Release builds require production Firebase configuration.".into());
            }
            if config.project_id != "hazcom-navigator-dev"
                || config.auth_domain != "hazcom-navigator-dev.firebaseapp.com"
                || config.storage_bucket != "hazcom-navigator-dev.firebasestorage.app"
            {
                return Err("Development sign-in accepts only HazCom Navigator Dev.".into());
            }
        }
        Environment::Production => {
            if config.project_id == "hazcom-navigator-dev"
                || config.project_id.starts_with("demo-")
                || config.project_id.contains("emulator")
                || config.auth_domain == "hazcom-navigator-dev.firebaseapp.com"
                || config.storage_bucket == "hazcom-navigator-dev.firebasestorage.app"
                || unsafe_production_host(&config.auth_domain)
                || unsafe_production_host(&config.storage_bucket)
            {
                return Err("Production sign-in cannot use development, local, or emulator Firebase resources.".into());
            }
        }
    }
    Ok(())
}

fn relay_csp(auth_domain: &str) -> String {
    format!("default-src 'none'; script-src 'unsafe-inline' https://www.gstatic.com https://apis.google.com; style-src 'unsafe-inline'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://{auth_domain}; frame-src https://{auth_domain}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
}

async fn receive_token(
    rx: oneshot::Receiver<String>,
    duration: Duration,
) -> Result<String, String> {
    match tokio::time::timeout(duration, rx).await {
        Ok(Ok(token)) => Ok(token),
        _ => Err("Sign-in timed out or was cancelled. Try again from HazCom Navigator.".into()),
    }
}

// System-browser Firebase Google sign-in. Environment validation runs before the
// loopback listener starts. Credentials never enter URLs, storage, or diagnostics.
#[tauri::command]
pub async fn google_browser_sign_in(
    app: tauri::AppHandle,
    environment: Environment,
    config: FirebaseConfig,
) -> Result<String, String> {
    validate_config(environment, &config, !cfg!(debug_assertions))?;
    let _guard = SignInGuard::begin()?;
    let listener = TcpListener::bind(LOOPBACK_ADDRESS)
        .await
        .map_err(|_| "Cannot start local sign-in listener.")?;
    let host = format!(
        "localhost:{}",
        listener
            .local_addr()
            .map_err(|_| "No sign-in port.")?
            .port()
    );
    let mut random = [0u8; 32];
    rand::rng().fill_bytes(&mut random);
    let nonce: String = random.iter().map(|v| format!("{v:02x}")).collect();
    let json = serde_json::to_string(&config)
        .map_err(|_| "Invalid Firebase configuration.")?
        .replace('<', "\\u003c");
    let label = match environment {
        Environment::Development => "development",
        Environment::Production => "production",
    };
    let html = include_str!("browser-auth.html")
        .replace("__FIREBASE_CONFIG__", &json)
        .replace("__ENVIRONMENT_LABEL__", label);
    let (tx, rx) = oneshot::channel();
    let relay = Relay {
        host: host.clone(),
        nonce: nonce.clone(),
        html,
        csp: relay_csp(&config.auth_domain),
        sender: Arc::new(Mutex::new(Some(tx))),
    };
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let mut server = tokio::spawn(async move {
        axum::serve(listener, router(relay))
            .with_graceful_shutdown(async {
                let _ = stop_rx.await;
            })
            .await
    });
    let result = match app
        .opener()
        .open_url(format!("http://{host}/#{nonce}"), None::<&str>)
    {
        Ok(_) => receive_token(rx, Duration::from_secs(180)).await,
        Err(_) => Err("Could not open the system browser.".into()),
    };
    let _ = stop_tx.send(());
    if tokio::time::timeout(Duration::from_secs(2), &mut server)
        .await
        .is_err()
    {
        server.abort();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    fn config(environment: Environment) -> FirebaseConfig {
        match environment {
            Environment::Development => FirebaseConfig {
                api_key: "AIzaSySyntheticDevelopmentKey123456".into(),
                auth_domain: "hazcom-navigator-dev.firebaseapp.com".into(),
                project_id: "hazcom-navigator-dev".into(),
                app_id: "1:391606138651:web:b4b8dab8d0ef45d43f85be".into(),
                storage_bucket: "hazcom-navigator-dev.firebasestorage.app".into(),
            },
            Environment::Production => FirebaseConfig {
                api_key: "AIzaSySyntheticProductionKey1234567".into(),
                auth_domain: "hazcom-navigator.firebaseapp.com".into(),
                project_id: "hazcom-navigator-prod".into(),
                app_id: "1:123456789012:web:abcdef0123456789".into(),
                storage_bucket: "hazcom-navigator-prod.firebasestorage.app".into(),
            },
        }
    }
    fn relay(sender: oneshot::Sender<String>) -> Relay {
        Relay {
            host: "localhost:4567".into(),
            nonce: "a".repeat(64),
            html: "test".into(),
            csp: relay_csp("hazcom-navigator.firebaseapp.com"),
            sender: Arc::new(Mutex::new(Some(sender))),
        }
    }
    #[tokio::test]
    async fn relay_rejects_csrf_rebinding_replay_and_oversized_bodies() {
        let (tx, mut rx) = oneshot::channel();
        let app = router(relay(tx));
        let body =
            serde_json::json!({"nonce":"a".repeat(64),"idToken":"x".repeat(100)}).to_string();
        for (host, origin, nonce) in [
            ("evil.test", "http://localhost:4567", "a".repeat(64)),
            ("localhost:4567", "https://evil.test", "a".repeat(64)),
            ("localhost:4567", "http://localhost:4567", "wrong".into()),
        ] {
            let request = Request::post("/complete")
                .header("host", host)
                .header("origin", origin)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({"nonce":nonce,"idToken":"x".repeat(100)}).to_string(),
                ))
                .unwrap();
            assert_eq!(
                app.clone().oneshot(request).await.unwrap().status(),
                StatusCode::FORBIDDEN
            );
            assert!(rx.try_recv().is_err());
        }
        let request = || {
            Request::post("/complete")
                .header("host", "localhost:4567")
                .header("origin", "http://localhost:4567")
                .header("content-type", "application/json")
                .body(Body::from(body.clone()))
                .unwrap()
        };
        assert_eq!(
            app.clone().oneshot(request()).await.unwrap().status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(rx.await.unwrap(), "x".repeat(100));
        assert_eq!(
            app.clone().oneshot(request()).await.unwrap().status(),
            StatusCode::GONE
        );
        let oversized = Request::post("/complete")
            .header("content-type", "application/json")
            .body(Body::from("x".repeat(17000)))
            .unwrap();
        assert_eq!(
            app.oneshot(oversized).await.unwrap().status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[test]
    fn configuration_and_release_guards_fail_closed() {
        assert!(validate_config(
            Environment::Development,
            &config(Environment::Development),
            false
        )
        .is_ok());
        assert!(validate_config(
            Environment::Production,
            &config(Environment::Production),
            true
        )
        .is_ok());
        assert!(validate_config(
            Environment::Development,
            &config(Environment::Development),
            true
        )
        .unwrap_err()
        .contains("Release builds"));
        let mut unsafe_config = config(Environment::Production);
        unsafe_config.project_id = "demo-hazcom-navigator".into();
        assert!(validate_config(Environment::Production, &unsafe_config, true).is_err());
        let mut unsafe_config = config(Environment::Production);
        unsafe_config.auth_domain = "firebase-emulator.example.com".into();
        assert!(validate_config(Environment::Production, &unsafe_config, true).is_err());
        let mut malformed = config(Environment::Production);
        malformed.auth_domain = "https://hazcom.example.com/path".into();
        assert!(validate_config(Environment::Production, &malformed, true).is_err());
    }

    #[tokio::test]
    async fn relay_uses_exact_environment_domain_in_csp() {
        for domain in [
            "hazcom-navigator-dev.firebaseapp.com",
            "hazcom-navigator.firebaseapp.com",
        ] {
            let (tx, _) = oneshot::channel();
            let app = router(Relay {
                host: "localhost:4567".into(),
                nonce: "a".repeat(64),
                html: "test".into(),
                csp: relay_csp(domain),
                sender: Arc::new(Mutex::new(Some(tx))),
            });
            let response = app
                .oneshot(
                    Request::get("/")
                        .header("host", "localhost:4567")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let csp = response
                .headers()
                .get("content-security-policy")
                .unwrap()
                .to_str()
                .unwrap();
            assert!(csp.contains(&format!("frame-src https://{domain};")));
            assert!(csp.contains(&format!("connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://{domain};")));
            assert!(!csp.contains("*.firebaseapp.com"));
            assert!(!csp.contains(if domain.contains("-dev") {
                "frame-src https://hazcom-navigator.firebaseapp.com;"
            } else {
                "frame-src https://hazcom-navigator-dev.firebaseapp.com;"
            }));
        }
    }

    #[tokio::test]
    async fn timeout_cancellation_and_concurrency_release_the_attempt() {
        assert_eq!(LOOPBACK_ADDRESS, "127.0.0.1:0");
        let guard = SignInGuard::begin().unwrap();
        assert!(SignInGuard::begin().is_err());
        let (_tx, rx) = oneshot::channel();
        assert!(receive_token(rx, Duration::from_millis(1)).await.is_err());
        drop(guard);
        assert!(SignInGuard::begin().is_ok());
        SIGNING_IN.store(false, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel::<String>();
        drop(tx);
        assert!(receive_token(rx, Duration::from_secs(1)).await.is_err());
    }
}
