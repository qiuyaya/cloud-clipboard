/**
 * Application-wide constants for the cloud clipboard
 */

// ====== 文件管理 ======

/** 文件最大保留时间（小时） */
export const FILE_RETENTION_HOURS = 12;

/** 文件清理间隔（毫秒） */
export const FILE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟

/** 文件大小上限（字节），100MB */
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// ====== 房间管理 ======

/** 房间不活跃销毁阈值（毫秒），24 小时 */
export const ROOM_INACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** 房间清理间隔（毫秒），1 分钟 */
export const ROOM_CLEANUP_INTERVAL_MS = 1 * 60 * 1000;

// ====== 消息管理 ======

/** 加入房间时发送的初始消息数量 */
export const INITIAL_MESSAGE_LIMIT = 100;

// ====== 验证规则 ======

/** 用户名最大长度 */
export const MAX_USERNAME_LENGTH = 50;

/** Room Key 最小长度 */
export const ROOM_KEY_MIN_LENGTH = 6;

/** Room Key 最大长度 */
export const ROOM_KEY_MAX_LENGTH = 50;

// ====== 客户端 Socket 配置 ======

/** Socket 重连尝试次数 */
export const SOCKET_RECONNECTION_ATTEMPTS = 5;

/** Socket 重连延迟（毫秒） */
export const SOCKET_RECONNECTION_DELAY_MS = 1000;

/** Socket 连接超时（毫秒） */
export const SOCKET_TIMEOUT_MS = 20000;

/** 用户不活跃自动登出时间（毫秒），2 小时 */
export const USER_INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
