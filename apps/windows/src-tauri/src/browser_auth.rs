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

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FirebaseConfig {
    api_key: String,
    auth_domain: String,
    project_id: String,
    app_id: String,
}

#[derive(Clone)]
struct Relay {
    host: String,
    nonce: String,
    html: String,
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
    ([ ("cache-control", "no-store"), ("referrer-policy", "no-referrer"), ("x-frame-options", "DENY"),
       ("content-security-policy", "default-src 'none'; script-src 'unsafe-inline' https://www.gstatic.com https://apis.google.com; style-src 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com; frame-src https://hazcom-navigator-dev.firebaseapp.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'") ], Html(relay.html)).into_response()
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

// CODEX HANDOFF: Minimal development-only system-browser auth. Release builds fail closed.
// Bound only to loopback, random ephemeral port and 256-bit nonce, strict Host/Origin,
// bounded body, one-use credential callback and three-minute lifetime. Never log credentials.
#[tauri::command]
pub async fn google_browser_sign_in(
    app: tauri::AppHandle,
    config: FirebaseConfig,
) -> Result<String, String> {
    if !cfg!(debug_assertions) {
        return Err("Production browser sign-in is not configured yet.".into());
    }
    if config.project_id != "hazcom-navigator-dev"
        || config.auth_domain != "hazcom-navigator-dev.firebaseapp.com"
    {
        return Err("The development sign-in relay only accepts HazCom Navigator Dev.".into());
    }
    if SIGNING_IN.swap(true, Ordering::SeqCst) {
        return Err("A browser sign-in is already running.".into());
    }
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            SIGNING_IN.store(false, Ordering::SeqCst);
        }
    }
    let _reset = Reset;
    let listener = TcpListener::bind("127.0.0.1:0")
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
    let html = include_str!("browser-auth.html").replace("__FIREBASE_CONFIG__", &json);
    let (tx, rx) = oneshot::channel();
    let relay = Relay {
        host: host.clone(),
        nonce: nonce.clone(),
        html,
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
        Ok(_) => match tokio::time::timeout(Duration::from_secs(180), rx).await {
            Ok(Ok(token)) => Ok(token),
            _ => Err("Sign-in timed out. Try again from HazCom Navigator.".into()),
        },
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
    #[tokio::test]
    async fn relay_rejects_csrf_rebinding_replay_and_oversized_bodies() {
        let (tx, mut rx) = oneshot::channel();
        let relay = Relay {
            host: "localhost:4567".into(),
            nonce: "a".repeat(64),
            html: "test".into(),
            sender: Arc::new(Mutex::new(Some(tx))),
        };
        let app = router(relay);
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
}
