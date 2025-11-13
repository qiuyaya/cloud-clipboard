/**
 * Share API Service
 * Handles all share-related API calls
 */

export interface CreateShareRequest {
  fileId: string;
  password?: string;
  expiresInDays?: number;
}

export interface ShareLinkResponse {
  shareId: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  hasPassword: boolean;
  accessCount: number;
}

export interface ShareLinkSummary {
  shareId: string;
  originalFilename: string;
  fileSize: number;
  createdAt: string;
  expiresAt: string;
  status: "active" | "expired";
  accessCount: number;
  hasPassword: boolean;
}

export interface ListShareLinksResponse {
  shares: ShareLinkSummary[];
  total: number;
}

export interface ShareDetails {
  shareId: string;
  fileId: string;
  createdAt: string;
  expiresAt: string;
  isActive: boolean;
  isExpired: boolean;
  accessCount: number;
  lastAccessedAt: string | null;
  createdBy: string;
  hasPassword: boolean;
  status: "active" | "expired";
}

export interface ApiError {
  success: false;
  error: string;
  message: string;
}

const API_BASE = "/api/share";

class ShareApiService {
  /**
   * Create a new share link
   */
  async createShare(request: CreateShareRequest): Promise<ShareLinkResponse> {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // Include session cookie
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      // Try to parse error response, but handle cases where it's not JSON
      try {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create share link");
      } catch (e) {
        // If JSON parsing fails, use generic error
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * List user's share links
   */
  async listShares(params?: {
    status?: "active" | "expired" | "all";
    limit?: number;
    offset?: number;
  }): Promise<ListShareLinksResponse> {
    const queryParams = new URLSearchParams();

    if (params?.status) queryParams.append("status", params.status);
    if (params?.limit) queryParams.append("limit", params.limit.toString());
    if (params?.offset) queryParams.append("offset", params.offset.toString());

    const response = await fetch(`${API_BASE}?${queryParams.toString()}`, {
      credentials: "include",
    });

    if (!response.ok) {
      try {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to list shares");
      } catch (e) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * Get share details
   */
  async getShareDetails(shareId: string): Promise<ShareDetails> {
    const response = await fetch(`${API_BASE}/${shareId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      try {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to get share details");
      } catch (e) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * Revoke a share link
   */
  async revokeShare(shareId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/${shareId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) {
      try {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to revoke share");
      } catch (e) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
  }

  /**
   * Permanently delete a share link
   */
  async permanentDeleteShare(shareId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/${shareId}/permanent-delete`, {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      try {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to delete share");
      } catch (e) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
  }

  /**
   * Get access logs for a share
   */
  async getAccessLogs(
    shareId: string,
    limit?: number,
  ): Promise<{
    logs: Array<{
      timestamp: string;
      ipAddress: string;
      userAgent?: string;
      success: boolean;
      errorCode?: string;
      bytesTransferred?: number;
    }>;
    total: number;
  }> {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.append("limit", limit.toString());

    const response = await fetch(`${API_BASE}/${shareId}/access?${queryParams.toString()}`, {
      credentials: "include",
    });

    if (!response.ok) {
      try {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to get access logs");
      } catch (e) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * Download file from share link (with optional password)
   * Returns a blob of the file
   */
  async downloadShare(shareId: string, password?: string): Promise<Blob> {
    const headers: Record<string, string> = {};

    // If password is provided, use Basic Auth
    if (password) {
      const credentials = btoa(`user:${password}`);
      headers["Authorization"] = `Basic ${credentials}`;
    }

    const response = await fetch(`${API_BASE}/${shareId}/download`, {
      headers,
      credentials: "include",
    });

    if (!response.ok) {
      try {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to download file");
      } catch (e) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    return response.blob();
  }

  /**
   * Test if a share link is accessible (without downloading)
   */
  async testShare(shareId: string): Promise<{
    accessible: boolean;
    requiresPassword: boolean;
    expiresAt?: string;
    status?: string;
  }> {
    try {
      const response = await fetch(`${API_BASE}/${shareId}`, {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            accessible: true,
            requiresPassword: true,
          };
        }
        return {
          accessible: false,
          requiresPassword: false,
        };
      }

      try {
        const data = await response.json();
        return {
          accessible: true,
          requiresPassword: data.data.hasPassword,
          expiresAt: data.data.expiresAt,
          status: data.data.status,
        };
      } catch (e) {
        // If JSON parsing fails, use default values
        return {
          accessible: true,
          requiresPassword: false,
        };
      }
    } catch (error) {
      return {
        accessible: false,
        requiresPassword: false,
      };
    }
  }
}

// Export singleton instance
export const shareApi = new ShareApiService();
