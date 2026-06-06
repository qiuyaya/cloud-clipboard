// Use the library modules instead of redefining them
use cloud_clipboard_server::{AppState, config, routes, services};

use axum::http::{HeaderName, HeaderValue, header};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request},
    http::{Method, StatusCode},
    middleware::{self as axum_middleware, Next},
    response::Response,
    routing::get,
};
use socketioxide::SocketIo;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tower::ServiceBuilder;
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::routes::{api_info, files, health, rooms, share};
use crate::services::SqlitePersistenceService;
use crate::services::persistence::PersistenceServiceTrait;
use crate::services::traits::{FileManagerTrait, RoomServiceTrait, ShareServiceTrait};
use crate::services::{
    FileManager, NoOpPersistenceService, PersistedRoom, RoomEvent, RoomService, ShareService,
};
use cloud_clipboard_server::middleware::rate_limit::{
    RateLimitConfig, RateLimitMiddleware, public_download_rate_limiter, strict_rate_limiter,
};
use cloud_clipboard_server::models::Message;

const STATIC_ENTRY_CACHE_CONTROL: &str = "no-cache, must-revalidate";
const STATIC_IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

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

    // Initialize centralized config (reads all env vars once)
    let cfg = config::init_config();

    let is_production = cfg.is_production();

    // Build RateLimitConfig from AppConfig
    let rate_limit_config = RateLimitConfig::from_app_config(cfg);
    tracing::info!(?rate_limit_config, "Rate limit configuration loaded");

    tracing::info!("Starting Cloud Clipboard Server (Rust)");
    tracing::info!("Port: {}", cfg.port);
    tracing::info!("Production mode: {}", is_production);
    if !cfg.base_path.is_empty() {
        tracing::info!("Base path: {}", cfg.base_path);
    }

    // Initialize rate limiters
    let strict_limiter = strict_rate_limiter(&rate_limit_config);
    let public_download_limiter = public_download_rate_limiter(&rate_limit_config);

    // Initialize persistence service and load pinned rooms
    let persistence: Arc<dyn PersistenceServiceTrait>;
    let pinned_rooms: HashMap<String, (PersistedRoom, Vec<Message>)>;
    if cfg.persistence_enabled {
        let db_path = std::path::PathBuf::from(&cfg.persistence_db_path);
        let max_messages = cfg.persistence_max_messages;
        let svc: SqlitePersistenceService =
            SqlitePersistenceService::with_writer(db_path, max_messages);
        svc.initialize()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize persistence: {}", e))?;
        let loaded = svc
            .load_pinned_rooms()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to load pinned rooms: {}", e))?;
        tracing::info!("Loaded {} pinned rooms from persistence", loaded.len());
        persistence = Arc::new(svc);
        pinned_rooms = loaded;
    } else {
        tracing::info!("Persistence disabled, using NoOpPersistenceService");
        persistence = Arc::new(NoOpPersistenceService::new());
        pinned_rooms = HashMap::new();
    };

    // Create RoomService with or without pre-loaded pinned rooms
    let room_service: Arc<RoomService> = if pinned_rooms.is_empty() {
        Arc::new(RoomService::new(persistence.clone()))
    } else {
        Arc::new(RoomService::with_pinned_rooms(
            pinned_rooms,
            persistence.clone(),
        ))
    };
    let file_manager = Arc::new(FileManager::new()?);
    let share_service = Arc::new(ShareService::new());

    // Startup orphaned files cleanup
    if cfg.cleanup_orphaned_files_at_startup {
        tracing::info!("Running startup orphaned files cleanup...");
        let cleaned = file_manager.cleanup_orphaned_files().await;
        tracing::info!("Startup cleanup: removed {} orphaned files", cleaned);
    }

    let app_state = AppState::new(
        room_service.clone() as Arc<dyn RoomServiceTrait>,
        file_manager.clone() as Arc<dyn FileManagerTrait>,
        share_service.clone() as Arc<dyn ShareServiceTrait>,
    );

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
                        tracing::info!(
                            "Room {} destroyed event received, cleaning up files",
                            room_key
                        );
                        let deleted_files = file_manager_for_events.delete_room_files(&room_key);

                        if !deleted_files.is_empty() {
                            let filenames: Vec<String> = deleted_files
                                .iter()
                                .map(|f| f.original_name.clone())
                                .collect();

                            // Broadcast roomDestroyed event to clients
                            let event = serde_json::json!({
                                "roomKey": room_key,
                                "deletedFiles": filenames,
                            });
                            let _ = io_for_events
                                .to(room_key.clone())
                                .emit("roomDestroyed", &event);

                            // Also send systemMessage
                            let sys_msg = serde_json::json!({
                                "type": "room_destroyed",
                                "data": {
                                    "roomKey": room_key,
                                    "deletedFiles": filenames,
                                }
                            });
                            let _ = io_for_events.to(room_key).emit("systemMessage", &sys_msg);

                            tracing::info!(
                                "Room destroyed - deleted {} files, notified clients",
                                deleted_files.len()
                            );
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
        // In production, read allowed origins from CLIENT_URL env var (comma-separated)
        // If not configured, do not allow any cross-origin requests (same-origin only)
        let allowed_origins: Vec<HeaderValue> = cfg
            .client_url
            .as_ref()
            .map(|urls| {
                urls.split(',')
                    .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
                    .collect()
            })
            .unwrap_or_default();

        if allowed_origins.is_empty() {
            tracing::warn!(
                "No CLIENT_URL configured in production. CORS will reject cross-origin requests."
            );
            // No allowed origins: only same-origin requests will work
            CorsLayer::new()
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
                .allow_headers([
                    header::CONTENT_TYPE,
                    header::AUTHORIZATION,
                    header::ACCEPT,
                    header::ORIGIN,
                    header::CACHE_CONTROL,
                ])
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
    } else {
        let allowed_origins: Vec<HeaderValue> = cfg
            .client_url
            .as_ref()
            .map(|urls| {
                urls.split(',')
                    .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
                    .collect()
            })
            .unwrap_or_else(|| {
                "http://localhost:3000,http://localhost:3002"
                    .split(',')
                    .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
                    .collect()
            });

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
    let cleanup_share_service = share_service.clone();

    // Start background cleanup tasks
    let room_cleanup_interval = cfg.room_cleanup_interval_secs;
    let file_cleanup_interval = cfg.file_cleanup_interval_secs;
    tokio::spawn(async move {
        run_cleanup_tasks(
            cleanup_room_service,
            cleanup_file_manager,
            cleanup_share_service,
            room_cleanup_interval,
            file_cleanup_interval,
        )
        .await;
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
        // Override axum's default 2MB body limit for file uploads (actual limit enforced by RequestBodyLimitLayer)
        .nest(
            "/api/files",
            files::router().layer(DefaultBodyLimit::disable()),
        )
        // Share routes - internal per-operation rate limiting
        .nest("/api/share", share::router())
        // Public file download - dedicated public download rate limit
        .nest(
            "/public/file",
            Router::new()
                .route("/{share_id}", get(share::public_download))
                .layer(public_download_rate_limit),
        )
        .fallback(api_not_found)
        .with_state(app_state);

    // Apply BASE_PATH nesting if configured
    let app = if cfg.base_path.is_empty() {
        Router::new().merge(api_router)
    } else {
        Router::new().nest(&cfg.base_path, api_router)
    }
        // Global request body size limit (100MB, matching MAX_FILE_SIZE)
        .layer(RequestBodyLimitLayer::new(cfg.max_file_size as usize))
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
    let app = if !cfg.allow_http {
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
    let app = if std::path::Path::new(&cfg.static_dir).exists() {
        let index_path = format!("{}/index.html", cfg.static_dir);
        tracing::info!("Serving static files from: {}", cfg.static_dir);
        let static_service = ServiceBuilder::new()
            .layer(axum_middleware::from_fn(set_static_cache_headers))
            .service(ServeDir::new(&cfg.static_dir).not_found_service(ServeFile::new(index_path)));

        app.fallback_service(static_service)
    } else {
        tracing::info!(
            "Static directory '{}' not found, skipping static file serving",
            cfg.static_dir
        );
        app
    }
    .layer(socket_layer);

    // Start server
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port)).await?;
    tracing::info!("Cloud Clipboard server listening on port {}", cfg.port);
    tracing::info!("WebSocket server ready for connections");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(persistence.clone()))
        .await?;

    Ok(())
}

async fn set_static_cache_headers(request: Request, next: Next) -> Response {
    let is_asset_request = is_immutable_static_asset(request.uri().path());
    let mut response = next.run(request).await;
    let cache_control = static_cache_control_for_response(is_asset_request, response.status());

    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );

    response
}

fn static_cache_control_for_response(is_asset_request: bool, status: StatusCode) -> &'static str {
    if is_asset_request && status.is_success() {
        STATIC_IMMUTABLE_CACHE_CONTROL
    } else {
        STATIC_ENTRY_CACHE_CONTROL
    }
}

fn is_immutable_static_asset(path: &str) -> bool {
    path.contains("/assets/")
}

/// Run periodic cleanup tasks
async fn run_cleanup_tasks(
    room_service: Arc<RoomService>,
    file_manager: Arc<FileManager>,
    share_service: Arc<ShareService>,
    room_cleanup_interval_secs: u64,
    file_cleanup_interval_secs: u64,
) {
    tracing::info!(
        "Cleanup tasks started: room_interval={}s, file_interval={}s",
        room_cleanup_interval_secs,
        file_cleanup_interval_secs
    );

    // Initial cleanup
    {
        tracing::info!("Running initial room cleanup...");
        let destroyed = room_service.cleanup_inactive_rooms();
        tracing::info!(
            "Initial cleanup: destroyed {} inactive rooms",
            destroyed.len()
        );
    }

    {
        tracing::info!("Running initial file cleanup...");
        let cleaned = file_manager.cleanup_expired_files().await;
        tracing::info!("Initial cleanup: removed {} expired files", cleaned.len());
    }

    {
        tracing::info!("Running initial share cleanup...");
        let cleaned = share_service.cleanup_expired_shares();
        tracing::info!("Initial cleanup: removed {} expired shares", cleaned.len());
    }

    // Room cleanup interval
    let room_interval = Duration::from_secs(room_cleanup_interval_secs);
    let mut room_interval = tokio::time::interval(room_interval);
    room_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // File cleanup interval (same as share cleanup)
    let file_interval = Duration::from_secs(file_cleanup_interval_secs);
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
                tracing::debug!("Running scheduled file and share cleanup...");
                let cleaned_files = file_manager.cleanup_expired_files().await;
                let cleaned_shares = share_service.cleanup_expired_shares();
                if !cleaned_files.is_empty() || !cleaned_shares.is_empty() {
                    tracing::info!("Scheduled cleanup: removed {} expired files, {} expired shares",
                        cleaned_files.len(), cleaned_shares.len());
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

async fn shutdown_signal(persistence: Arc<dyn PersistenceServiceTrait>) {
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

    // Shutdown persistence service
    if let Err(e) = persistence.shutdown().await {
        tracing::warn!("Error shutting down persistence service: {}", e);
    }
}
