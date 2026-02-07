mod models;
mod routes;
mod services;
mod middleware;
mod utils;

use axum::{
    Router,
    http::Method,
    routing::get,
};
use socketioxide::SocketIo;
use std::sync::Arc;
use tower_http::{
    cors::{Any, CorsLayer},
    compression::CompressionLayer,
    trace::TraceLayer,
    set_header::SetResponseHeaderLayer,
};
use axum::http::{HeaderValue, HeaderName};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::services::{RoomService, FileManager, ShareService};
use crate::routes::{health, api_info, rooms, files, share};

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub room_service: Arc<RoomService>,
    pub file_manager: Arc<FileManager>,
    pub share_service: Arc<ShareService>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "cloud_clipboard_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()?;

    let is_production = std::env::var("NODE_ENV")
        .map(|v| v == "production")
        .unwrap_or(false);

    tracing::info!("Starting Cloud Clipboard Server (Rust)");
    tracing::info!("Port: {}", port);
    tracing::info!("Production mode: {}", is_production);

    // Initialize services
    let room_service = Arc::new(RoomService::new());
    let file_manager = Arc::new(FileManager::new()?);
    let share_service = Arc::new(ShareService::new());

    let app_state = AppState {
        room_service: room_service.clone(),
        file_manager: file_manager.clone(),
        share_service: share_service.clone(),
    };

    // Setup Socket.IO
    let (socket_layer, io) = SocketIo::builder()
        .with_state(app_state.clone())
        .build_layer();

    // Register Socket.IO event handlers
    services::socket::setup_socket_handlers(&io, room_service.clone());

    // Build CORS layer
    let cors = if is_production {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
            .allow_headers(Any)
            .allow_credentials(false)
    } else {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
            .allow_headers(Any)
            .allow_credentials(false)
    };

    // Build the router
    let app = Router::new()
        // Health endpoints (both with and without /api prefix)
        .route("/health", get(health::health_check))
        .route("/api/health", get(health::health_check))
        .route("/api", get(api_info::api_info))
        // Room routes
        .nest("/api/rooms", rooms::router())
        // File routes
        .nest("/api/files", files::router())
        // Share routes
        .nest("/api/share", share::router())
        // Public file download
        .route("/public/file/{share_id}", get(share::public_download))
        // State and middleware
        .with_state(app_state)
        .layer(socket_layer)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        // Security headers (similar to helmet)
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-xss-protection"),
            HeaderValue::from_static("1; mode=block"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ));

    // Start server
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    tracing::info!("Cloud Clipboard server listening on port {}", port);
    tracing::info!("WebSocket server ready for connections");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            tracing::info!("Received Ctrl+C, shutting down gracefully...");
        }
        _ = terminate => {
            tracing::info!("Received SIGTERM, shutting down gracefully...");
        }
    }
}
