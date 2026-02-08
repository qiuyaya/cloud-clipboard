mod models;
mod routes;
mod services;
mod middleware;
mod utils;

use axum::{
    Router,
    http::Method,
    routing::get,
    Json,
    http::StatusCode,
};
use socketioxide::SocketIo;
use std::sync::Arc;
use std::time::Duration;
use tower_http::{
    cors::{Any, CorsLayer},
    compression::CompressionLayer,
    trace::TraceLayer,
    set_header::SetResponseHeaderLayer,
    services::{ServeDir, ServeFile},
};
use axum::http::{HeaderValue, HeaderName, header};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::services::{RoomService, RoomEvent, FileManager, ShareService};
use crate::routes::{health, api_info, rooms, files, share};
use crate::middleware::rate_limit::{RateLimitMiddleware, RateLimitConfig, strict_rate_limiter, public_download_rate_limiter};

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub room_service: Arc<RoomService>,
    pub file_manager: Arc<FileManager>,
    pub share_service: Arc<ShareService>,
}

/// Cleanup task configuration
#[derive(Clone, Debug)]
pub struct CleanupConfig {
    pub room_cleanup_interval_secs: u64,
    pub file_cleanup_interval_secs: u64,
    pub startup_orphaned_files_cleanup: bool,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            room_cleanup_interval_secs: 60,         // 1 minute (aligned with Node.js)
            file_cleanup_interval_secs: 600,        // 10 minutes (aligned with Node.js)
            startup_orphaned_files_cleanup: true,
        }
    }
}

impl CleanupConfig {
    pub fn from_env() -> Self {
        Self {
            room_cleanup_interval_secs: std::env::var("ROOM_CLEANUP_INTERVAL_SECONDS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
            file_cleanup_interval_secs: std::env::var("FILE_CLEANUP_INTERVAL_SECONDS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(600),
            startup_orphaned_files_cleanup: std::env::var("CLEANUP_ORPHANED_FILES_AT_STARTUP")
                .map(|v| v.to_lowercase() == "true")
                .unwrap_or(true),
        }
    }
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

    let allow_http = std::env::var("ALLOW_HTTP")
        .map(|v| v.to_lowercase() == "true")
        .unwrap_or(false);

    // BASE_PATH for sub-path deployment (e.g., "/clipboard")
    let base_path = std::env::var("BASE_PATH")
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string();

    // Load configurations
    let rate_limit_config = RateLimitConfig::from_env();
    tracing::info!(?rate_limit_config, "Rate limit configuration loaded");

    let cleanup_config = CleanupConfig::from_env();
    tracing::info!(?cleanup_config, "Cleanup configuration loaded");

    tracing::info!("Starting Cloud Clipboard Server (Rust)");
    tracing::info!("Port: {}", port);
    tracing::info!("Production mode: {}", is_production);
    if !base_path.is_empty() {
        tracing::info!("Base path: {}", base_path);
    }

    // Initialize rate limiters
    let strict_limiter = strict_rate_limiter(&rate_limit_config);
    let public_download_limiter = public_download_rate_limiter(&rate_limit_config);

    // Initialize services
    let room_service = Arc::new(RoomService::new());
    let file_manager = Arc::new(FileManager::new()?);
    let share_service = Arc::new(ShareService::new());

    // Startup orphaned files cleanup
    if cleanup_config.startup_orphaned_files_cleanup {
        tracing::info!("Running startup orphaned files cleanup...");
        let cleaned = file_manager.cleanup_orphaned_files().await;
        tracing::info!("Startup cleanup: removed {} orphaned files", cleaned);
    }

    let app_state = AppState {
        room_service: room_service.clone(),
        file_manager: file_manager.clone(),
        share_service: share_service.clone(),
    };

    // Setup Socket.IO
    let (socket_layer, io) = SocketIo::builder()
        .with_state(app_state.clone())
        .ping_timeout(Duration::from_secs(60))
        .ping_interval(Duration::from_secs(25))
        .build_layer();

    // Register Socket.IO event handlers
    services::socket::setup_socket_handlers(&io, room_service.clone());

    // Start room event listener for file cleanup and socket broadcasting
    {
        let mut event_rx = room_service.subscribe();
        let file_manager_for_events = file_manager.clone();
        let io_for_events = io.clone();
        tokio::spawn(async move {
            loop {
                match event_rx.recv().await {
                    Ok(RoomEvent::RoomDestroyed { room_key }) => {
                        tracing::info!("Room {} destroyed event received, cleaning up files", room_key);
                        let deleted_files = file_manager_for_events.delete_room_files(&room_key);

                        if !deleted_files.is_empty() {
                            let filenames: Vec<String> = deleted_files.iter()
                                .map(|f| f.original_name.clone())
                                .collect();

                            // Broadcast roomDestroyed event to clients
                            let event = serde_json::json!({
                                "roomKey": room_key,
                                "deletedFiles": filenames,
                            });
                            let _ = io_for_events.to(room_key.clone()).emit("roomDestroyed", &event);

                            // Also send systemMessage
                            let sys_msg = serde_json::json!({
                                "type": "room_destroyed",
                                "data": {
                                    "roomKey": room_key,
                                    "deletedFiles": filenames,
                                }
                            });
                            let _ = io_for_events.to(room_key).emit("systemMessage", &sys_msg);

                            tracing::info!("Room destroyed - deleted {} files, notified clients", deleted_files.len());
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("Room event listener lagged by {} events", n);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        tracing::info!("Room event channel closed, stopping listener");
                        break;
                    }
                }
            }
        });
    }

    // Build CORS layer
    let cors = if is_production {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
            .allow_headers(Any)
            .allow_credentials(false)
    } else {
        let allowed_origins: Vec<HeaderValue> = std::env::var("CLIENT_URL")
            .unwrap_or_else(|_| "http://localhost:3000,http://localhost:3002".to_string())
            .split(',')
            .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
            .collect();

        if allowed_origins.is_empty() {
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
                .allow_headers(Any)
                .allow_credentials(false)
        } else {
            CorsLayer::new()
                .allow_origin(allowed_origins)
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
                .allow_headers([
                    header::CONTENT_TYPE,
                    header::AUTHORIZATION,
                    header::ACCEPT,
                    header::ORIGIN,
                    header::CACHE_CONTROL,
                ])
                .allow_credentials(true)
        }
    };

    // Build rate limit middleware layers
    let strict_rate_limit = RateLimitMiddleware::new(strict_limiter);
    let public_download_rate_limit = RateLimitMiddleware::new(public_download_limiter);

    // Clone services for background tasks
    let cleanup_room_service = room_service.clone();
    let cleanup_file_manager = file_manager.clone();

    // Start background cleanup tasks
    tokio::spawn(async move {
        run_cleanup_tasks(cleanup_room_service, cleanup_file_manager, cleanup_config).await;
    });

    // Build the API router (routes relative to base path)
    // Each route group uses its own rate limiting (configured in respective router() functions)
    let api_router = Router::new()
        // Health endpoints (no rate limit)
        .route("/health", get(health::health_check))
        .route("/api/health", get(health::health_check))
        .route("/api", get(api_info::api_info))
        // Room routes - strict rate limit
        .nest("/api/rooms", rooms::router().layer(strict_rate_limit))
        // File routes - internal per-operation rate limiting
        .nest("/api/files", files::router())
        // Share routes - internal per-operation rate limiting
        .nest("/api/share", share::router())
        // Public file download - dedicated public download rate limit
        .nest("/public/file", Router::new()
            .route("/{share_id}", get(share::public_download))
            .layer(public_download_rate_limit)
        )
        .fallback(api_not_found)
        .with_state(app_state);

    // Apply BASE_PATH nesting if configured
    let app = if base_path.is_empty() {
        Router::new().merge(api_router)
    } else {
        Router::new().nest(&base_path, api_router)
    }
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
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cross-origin-opener-policy"),
            HeaderValue::from_static("same-origin"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cross-origin-embedder-policy"),
            HeaderValue::from_static("require-corp"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; frame-ancestors 'none'"),
        ));

    // Add HSTS header when HTTPS is enforced (ALLOW_HTTP not set)
    let app = if !allow_http {
        tracing::info!("HSTS enabled (ALLOW_HTTP not set)");
        axum::Router::new()
            .merge(app)
            .layer(SetResponseHeaderLayer::overriding(
                HeaderName::from_static("strict-transport-security"),
                HeaderValue::from_static("max-age=31536000; includeSubDomains"),
            ))
    } else {
        tracing::info!("HSTS disabled (ALLOW_HTTP=true)");
        app
    };

    // Static file serving for production (SPA fallback)
    let static_dir = std::env::var("STATIC_DIR")
        .unwrap_or_else(|_| "./public".to_string());

    let app = if std::path::Path::new(&static_dir).exists() {
        let index_path = format!("{}/index.html", static_dir);
        tracing::info!("Serving static files from: {}", static_dir);
        app.fallback_service(
            ServeDir::new(&static_dir)
                .not_found_service(ServeFile::new(index_path))
        )
    } else {
        tracing::info!("Static directory '{}' not found, skipping static file serving", static_dir);
        app
    }
    .layer(socket_layer);

    // Start server
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    tracing::info!("Cloud Clipboard server listening on port {}", port);
    tracing::info!("WebSocket server ready for connections");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Run periodic cleanup tasks
async fn run_cleanup_tasks(
    room_service: Arc<RoomService>,
    file_manager: Arc<FileManager>,
    config: CleanupConfig,
) {
    tracing::info!(
        "Cleanup tasks started: room_interval={}s, file_interval={}s",
        config.room_cleanup_interval_secs,
        config.file_cleanup_interval_secs
    );

    // Initial cleanup
    {
        tracing::info!("Running initial room cleanup...");
        let destroyed = room_service.cleanup_inactive_rooms();
        tracing::info!("Initial cleanup: destroyed {} inactive rooms", destroyed.len());
    }

    {
        tracing::info!("Running initial file cleanup...");
        let cleaned = file_manager.cleanup_expired_files().await;
        tracing::info!("Initial cleanup: removed {} expired files", cleaned.len());
    }

    // Room cleanup interval
    let room_interval = Duration::from_secs(config.room_cleanup_interval_secs);
    let mut room_interval = tokio::time::interval(room_interval);
    room_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // File cleanup interval
    let file_interval = Duration::from_secs(config.file_cleanup_interval_secs);
    let mut file_interval = tokio::time::interval(file_interval);
    file_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = room_interval.tick() => {
                tracing::debug!("Running scheduled room cleanup...");
                let destroyed = room_service.cleanup_inactive_rooms();
                if !destroyed.is_empty() {
                    tracing::info!("Scheduled room cleanup: destroyed {} inactive rooms ({:?})",
                        destroyed.len(), destroyed);
                }
            }
            _ = file_interval.tick() => {
                tracing::debug!("Running scheduled file cleanup...");
                let cleaned = file_manager.cleanup_expired_files().await;
                if !cleaned.is_empty() {
                    tracing::info!("Scheduled file cleanup: removed {} expired files", cleaned.len());
                }
            }
        }
    }
}

/// Fallback handler for unmatched API routes
async fn api_not_found() -> (StatusCode, Json<routes::ApiResponse<()>>) {
    (
        StatusCode::NOT_FOUND,
        Json(routes::ApiResponse {
            success: false,
            message: Some("Not found".to_string()),
            data: None,
        }),
    )
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
