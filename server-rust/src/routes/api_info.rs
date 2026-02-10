use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiInfoResponse {
    pub success: bool,
    pub message: String,
    pub data: ApiInfoData,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiInfoData {
    pub version: String,
    pub endpoints: ApiEndpoints,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEndpoints {
    pub rooms: String,
    pub files: String,
    pub share: String,
    pub health: String,
}

pub async fn api_info() -> Json<ApiInfoResponse> {
    let version = env!("CARGO_PKG_VERSION");
    Json(ApiInfoResponse {
        success: true,
        message: format!("Cloud Clipboard API v{} (Rust)", version),
        data: ApiInfoData {
            version: version.to_string(),
            endpoints: ApiEndpoints {
                rooms: "/api/rooms".to_string(),
                files: "/api/files".to_string(),
                share: "/api/share".to_string(),
                health: "/api/health".to_string(),
            },
        },
    })
}
