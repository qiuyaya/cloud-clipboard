import { z } from "zod";

// XSS防护配置
const XSS_ALLOWED_TAGS = [
  "b", "i", "em", "strong", "a", "code", "pre", "br", "div", "span", "p",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
];

const XSS_ALLOWED_ATTR = ["href", "title", "class"];

// 基础的XSS过滤函数（无DOM依赖版本）
export function basicSanitize(input: string): string {
  if (typeof input !== "string") {
    return "";
  }

  return input
    // 移除script标签
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // 移除javascript:协议
    .replace(/javascript:/gi, "")
    // 移除on事件处理器
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\son\w+=\w+/gi, "")
    // 移除iframe标签
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    // 移除object/embed标签
    .replace(/<(object|embed)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "")
    // 移除style属性中的expression
    .replace(/style="[^"]*expression\([^)]*\)"/gi, "")
    .replace(/style='[^']*expression\([^)]*\)'/gi, "")
    // 移除危险的CSS属性
    .replace(/style="[^"]*(?:behavior|ms-behavior|activex-object)[^"]*"/gi, "")
    .replace(/style='[^']*(?:behavior|ms-behavior|activex-object)[^']*'/gi, "");
}

// DOMPurify包装函数（仅客户端使用）
export function sanitizeWithDOMPurify(dirty: string): string {
  // 在服务端或不支持DOMPurify的环境中使用basicSanitize
  if (typeof global === "undefined" || typeof (global as any).window === "undefined" || !(global as any).window.document || !(global as any).DOMPurify) {
    return basicSanitize(dirty);
  }

  const DOMPurify = (global as any).DOMPurify;
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: XSS_ALLOWED_TAGS,
    ALLOWED_ATTR: XSS_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: ["style", "img", "svg", "math"],
    FORBID_ATTR: ["style", "onerror", "onload"],
  });
}

// Zod验证器：确保消息内容是安全的
export const SafeTextContentSchema = z
  .string()
  .min(1, "Message content is required")
  .max(50000, "Message content too long (max 50,000 characters)")
  .refine((content) => {
    // 检查是否包含明显的XSS攻击
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /expression\(/i,
      /<iframe/i,
      /<object/i,
      /<embed/i,
    ];

    return !dangerousPatterns.some((pattern) => pattern.test(content));
  }, "Message contains potentially dangerous content")
  .refine((content) => {
    // 检查每行长度
    const lines = content.split("\n");
    return lines.every((line) => line.length <= 10000);
  }, "Individual lines cannot exceed 10,000 characters")
  .refine((content) => {
    // 检查总行数
    const lineCount = content.split("\n").length;
    return lineCount <= 1000;
  }, "Message cannot exceed 1,000 lines");

// 对消息内容进行XSS过滤
export function sanitizeMessageContent(content: unknown): string {
  if (typeof content !== "string") {
    return "";
  }

  // 先进行基础过滤
  const basic = basicSanitize(content);

  // 再进行DOMPurify过滤（如果可用）
  return sanitizeWithDOMPurify(basic);
}

// 验证并清理用户名
export function sanitizeUsername(name: unknown): string {
  if (typeof name !== "string") {
    return "";
  }

  return name
    .trim()
    .replace(/[<>]/g, "") // 移除尖括号
    .substring(0, 50); // 限制长度
}
