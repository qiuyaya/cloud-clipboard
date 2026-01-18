import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticateRoom } from "../middleware/auth";
import { validateParams } from "../middleware/validation";
import { uploadRateLimit, strictRateLimit } from "../middleware/rateLimit";
import { sanitizeFileName } from "@cloud-clipboard/shared";
import type { FileInfo } from "@cloud-clipboard/shared";
import * as fs from "fs";
import * as path from "path";
import type { FileManager } from "../services/FileManager";

const getProtocol = (req: any): string => {
  // Check for ALLOW_HTTP environment variable
  const allowHttp = process.env.ALLOW_HTTP === "true";

  if (allowHttp) {
    // If HTTP is allowed, use the actual protocol from the request
    return req.protocol;
  }

  // Default behavior: prefer HTTPS
  return req.secure ? "https" : "http";
};

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const uploadDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      // Verify directory is writable
      if (!fs.existsSync(uploadDir)) {
        throw new Error(`Upload directory does not exist: ${uploadDir}`);
      }
      cb(null, uploadDir);
    } catch (error) {
      console.error("Failed to create upload directory:", error);
      cb(error as Error, "");
    }
  },
  filename: (_req, file, cb) => {
    try {
      const sanitized = sanitizeFileName(file.originalname);
      const timestamp = Date.now();
      cb(null, `${timestamp}-${sanitized}`);
    } catch (error) {
      console.error("Failed to generate filename:", error);
      cb(error as Error, "");
    }
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    try {
      // Get file extension (lowercase)
      const fileExtension = path.extname(file.originalname).toLowerCase();

      // Dangerous extensions that could be used for attacks
      const dangerousExtensions = new Set([
        ".exe",
        ".bat",
        ".cmd",
        ".com",
        ".scr",
        ".pif",
        ".msi",
        ".jar",
        ".sh",
        ".bash",
        ".ps1",
        ".vbs",
        ".php",
        ".asp",
        ".aspx",
        ".jsp",
        ".py",
        ".rb",
        ".pl",
        ".c",
        ".cpp",
        ".cs",
        ".java",
        ".go",
        ".rs",
        ".swift",
        ".dll",
        ".so",
        ".dylib",
        ".app",
        ".deb",
        ".rpm",
        ".dmg",
      ]);

      // Check dangerous file extensions first
      if (dangerousExtensions.has(fileExtension)) {
        cb(new Error(`File extension ${fileExtension} is not allowed`));
        return;
      }

      // Additional filename validation to prevent path traversal
      if (
        file.originalname.includes("..") ||
        file.originalname.includes("/") ||
        file.originalname.includes("\\") ||
        file.originalname.includes(":") ||
        file.originalname.includes("*") ||
        file.originalname.includes("?") ||
        file.originalname.includes('"') ||
        file.originalname.includes("<") ||
        file.originalname.includes(">") ||
        file.originalname.includes("|")
      ) {
        cb(new Error("Invalid filename"));
        return;
      }

      // Allow any file type except dangerous extensions
      cb(null, true);
    } catch (error) {
      console.error("File filter error:", error);
      cb(new Error("File validation failed"));
    }
  },
});

const FileParamsSchema = z.object({
  fileId: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/, "Invalid file ID format")
    .refine(
      (fileId) => !fileId.includes("..") && !fileId.includes("/") && !fileId.includes("\\"),
      "File ID contains invalid characters",
    ),
});

export const createFileRoutes = (fileManager: FileManager): Router => {
  router.post(
    "/upload",
    uploadRateLimit.middleware(),
    authenticateRoom,
    upload.single("file"),
    async (req, res: any) => {
      try {
        if (!req.file) {
          res.status(400).json({
            success: false,
            message: "No file uploaded",
          });
          return;
        }

        // Calculate file hash for deduplication
        const fileHash = await fileManager.calculateFileHash(req.file.path);

        // Check if file with same hash already exists
        const existingFileId = fileManager.getFileIdByHash(fileHash);

        if (existingFileId) {
          // File already exists, return existing file info
          const existingFile = fileManager.getFile(existingFileId);

          if (existingFile) {
            console.log(
              `File deduplicated: ${req.file.originalname} (hash: ${fileHash.substring(0, 16)}...)`,
            );

            // Clean up the duplicate file that was just uploaded
            try {
              fs.unlinkSync(req.file.path);
              console.log(`Cleaned up duplicate file: ${req.file.path}`);
            } catch (cleanupError) {
              console.error("Failed to clean up duplicate file:", cleanupError);
            }

            const fileInfo: FileInfo = {
              name: existingFile.filename,
              size: existingFile.size,
              type: req.file.mimetype,
              lastModified: existingFile.uploadedAt.getTime(),
            };

            res.json({
              success: true,
              message: "File already exists, using existing copy",
              data: {
                fileId: existingFile.id,
                downloadUrl: `${getProtocol(req)}://${req.get("host")}/api/files/download/${existingFile.id}`,
                ...fileInfo,
                isDuplicate: true,
                originalFileId: existingFile.id,
              },
            });
            return;
          }
        }

        // New file, process it normally
        const fileInfo: FileInfo = {
          name: req.file.originalname,
          size: req.file.size,
          type: req.file.mimetype,
          lastModified: Date.now(),
        };

        const fileData = {
          id: req.file.filename,
          path: req.file.path,
          info: fileInfo,
          roomKey: req.roomKey,
          uploadedAt: new Date(),
        };

        // Track file in FileManager with hash
        try {
          fileManager.addFile({
            id: req.file.filename,
            filename: req.file.originalname,
            path: req.file.path,
            roomKey: req.roomKey!,
            uploadedAt: new Date(),
            size: req.file.size,
            hash: fileHash,
          });

          console.log(
            `New file uploaded: ${req.file.originalname} (hash: ${fileHash.substring(0, 16)}...)`,
          );
        } catch (fileError) {
          console.error("Failed to track file in FileManager:", fileError);
          // Clean up the uploaded file if tracking fails
          try {
            fs.unlinkSync(req.file.path);
          } catch (cleanupError) {
            console.error("Failed to clean up file after tracking failure:", cleanupError);
          }
          res.status(500).json({
            success: false,
            message: "Failed to track uploaded file",
          });
          return;
        }

        res.json({
          success: true,
          message: "File uploaded successfully",
          data: {
            fileId: fileData.id,
            downloadUrl: `${getProtocol(req)}://${req.get("host")}/api/files/download/${fileData.id}`,
            ...fileInfo,
            isDuplicate: false,
          },
        });
      } catch (error) {
        console.error("File upload error:", error);

        // 如果文件已上传但处理失败，尝试清理
        if (req.file && req.file.path) {
          try {
            if (fs.existsSync(req.file.path)) {
              fs.unlinkSync(req.file.path);
              console.log(`Cleaned up failed upload: ${req.file.path}`);
            }
          } catch (cleanupError) {
            console.error("Failed to clean up file after upload error:", cleanupError);
          }
        }

        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : "Failed to upload file",
        });
      }
    },
  );

  router.get(
    "/download/:fileId",
    strictRateLimit.middleware(),
    validateParams(FileParamsSchema),
    (req, res: any) => {
      try {
        const { fileId } = req.params as { fileId: string };

        // Security: Strict path validation to prevent directory traversal
        const uploadsDir = path.resolve(process.cwd(), "uploads");
        const filePath = path.resolve(uploadsDir, fileId);

        // Ensure the resolved path is still within uploads directory
        if (!filePath.startsWith(uploadsDir + path.sep)) {
          res.status(403).json({
            success: false,
            message: "Access denied: Invalid file path",
          });
          return;
        }

        if (!fs.existsSync(filePath)) {
          res.status(404).json({
            success: false,
            message: "File not found",
          });
          return;
        }

        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          res.status(404).json({
            success: false,
            message: "File not found",
          });
          return;
        }

        // Security: Verify file is in our FileManager tracking
        const fileInfo = fileManager?.getFile(fileId);
        if (!fileInfo) {
          res.status(404).json({
            success: false,
            message: "File not found",
          });
          return;
        }

        res.download(filePath, (err: any) => {
          if (err) {
            console.error("File download error:", err);
            if (!res.headersSent) {
              res.status(500).json({
                success: false,
                message: "Failed to download file",
              });
            }
          }
        });
      } catch (error) {
        console.error("File download error:", error);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: "Failed to download file",
          });
        }
      }
    },
  );

  router.delete(
    "/:fileId",
    strictRateLimit.middleware(),
    authenticateRoom,
    validateParams(FileParamsSchema),
    (req, res: any) => {
      try {
        const { fileId } = req.params as { fileId: string };

        // Security: Verify file exists in our tracking system
        const fileInfo = fileManager?.getFile(fileId);
        if (!fileInfo) {
          res.status(404).json({
            success: false,
            message: "File not found",
          });
          return;
        }

        // Security: Verify user has access to this file's room
        if (fileInfo.roomKey !== req.roomKey!) {
          res.status(403).json({
            success: false,
            message: "Access denied",
          });
          return;
        }

        // Delete file using FileManager (safer than direct file operations)
        const result = fileManager?.deleteFile(fileId, "manual");
        if (!result) {
          res.status(500).json({
            success: false,
            message: "Failed to delete file",
          });
          return;
        }

        res.json({
          success: true,
          message: "File deleted successfully",
        });
      } catch (error) {
        console.error("File delete error:", error);
        res.status(500).json({
          success: false,
          message: "Failed to delete file",
        });
      }
    },
  );

  return router;
};
