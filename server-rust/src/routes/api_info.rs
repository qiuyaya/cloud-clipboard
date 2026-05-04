use axum::Json;
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_info_response_serialization() {
        let resp = ApiInfoResponse {
            success: true,
            message: "test".to_string(),
            data: ApiInfoData {
                version: "1.0.0".to_string(),
                endpoints: ApiEndpoints {
                    rooms: "/api/rooms".to_string(),
                    files: "/api/files".to_string(),
                    share: "/api/share".to_string(),
                    health: "/api/health".to_string(),
                },
            },
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"version\":\"1.0.0\""));
    }

    #[test]
    fn api_info_data_camel_case() {
        let data = ApiInfoData {
            version: "2.0.0".to_string(),
            endpoints: ApiEndpoints {
                rooms: "/r".to_string(),
                files: "/f".to_string(),
                share: "/s".to_string(),
                health: "/h".to_string(),
            },
        };
        let json = serde_json::to_string(&data).unwrap();
        // serde rename_all = "camelCase" applies to field names
        assert!(json.contains("\"version\""));
    }

    #[test]
    fn api_endpoints_serialization() {
        let endpoints = ApiEndpoints {
            rooms: "/api/rooms".to_string(),
            files: "/api/files".to_string(),
            share: "/api/share".to_string(),
            health: "/api/health".to_string(),
        };
        let json = serde_json::to_string(&endpoints).unwrap();
        let de: ApiEndpoints = serde_json::from_str(&json).unwrap();
        assert_eq!(de.rooms, "/api/rooms");
        assert_eq!(de.files, "/api/files");
        assert_eq!(de.share, "/api/share");
        assert_eq!(de.health, "/api/health");
    }

    #[test]
    fn api_info_response_camel_case() {
        let resp = ApiInfoResponse {
            success: true,
            message: "test".to_string(),
            data: ApiInfoData {
                version: "1.0.0".to_string(),
                endpoints: ApiEndpoints {
                    rooms: "/api/rooms".to_string(),
                    files: "/api/files".to_string(),
                    share: "/api/share".to_string(),
                    health: "/api/health".to_string(),
                },
            },
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"message\":\"test\""));
    }

    #[test]
    fn api_info_data_deserialize() {
        // ApiInfoData doesn't derive Deserialize, so test via ApiEndpoints which does
        let json = r#"{"rooms":"/r","files":"/f","share":"/s","health":"/h"}"#;
        let endpoints: ApiEndpoints = serde_json::from_str(json).unwrap();
        assert_eq!(endpoints.rooms, "/r");
        assert_eq!(endpoints.files, "/f");
    }

    #[test]
    fn api_info_response_false_success() {
        let resp = ApiInfoResponse {
            success: false,
            message: "error".to_string(),
            data: ApiInfoData {
                version: "0.0.0".to_string(),
                endpoints: ApiEndpoints {
                    rooms: "".to_string(),
                    files: "".to_string(),
                    share: "".to_string(),
                    health: "".to_string(),
                },
            },
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":false"));
    }

    #[tokio::test]
    async fn api_info_handler_returns_json() {
        let Json(response) = api_info().await;
        assert!(response.success);
        assert!(response.message.contains("Cloud Clipboard API"));
        assert!(!response.data.version.is_empty());
        assert_eq!(response.data.endpoints.rooms, "/api/rooms");
        assert_eq!(response.data.endpoints.files, "/api/files");
        assert_eq!(response.data.endpoints.share, "/api/share");
        assert_eq!(response.data.endpoints.health, "/api/health");
    }
}
