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
import { getPublicUrl } from "../utils/url";
import { log } from "../utils/logger";

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
      log.error("Failed to create upload directory", { error }, "FileRoutes");
      cb(error as Error, "");
    }
  },
  filename: (_req, file, cb) => {
    try {
      const sanitized = sanitizeFileName(file.originalname);
      const timestamp = Date.now();
      cb(null, `${timestamp}-${sanitized}`);
    } catch (error) {
      log.error("Failed to generate filename", { error }, "FileRoutes");
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
      log.error("File filter error", { error }, "FileRoutes");
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
            log.info(
              "File deduplicated",
              { filename: req.file.originalname, hash: fileHash.substring(0, 16) },
              "FileRoutes",
            );

            // Clean up the duplicate file that was just uploaded
            try {
              fs.unlinkSync(req.file.path);
              log.debug("Cleaned up duplicate file", { path: req.file.path }, "FileRoutes");
            } catch (cleanupError) {
              log.error("Failed to clean up duplicate file", { error: cleanupError }, "FileRoutes");
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
                downloadUrl: getPublicUrl(req, `/api/files/download/${existingFile.id}`),
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

          log.info(
            "New file uploaded",
            { filename: req.file.originalname, hash: fileHash.substring(0, 16) },
            "FileRoutes",
          );
        } catch (fileError) {
          log.error("Failed to track file in FileManager", { error: fileError }, "FileRoutes");
          // Clean up the uploaded file if tracking fails
          try {
            fs.unlinkSync(req.file.path);
          } catch (cleanupError) {
            log.error(
              "Failed to clean up file after tracking failure",
              { error: cleanupError },
              "FileRoutes",
            );
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
            downloadUrl: getPublicUrl(req, `/api/files/download/${fileData.id}`),
            ...fileInfo,
            isDuplicate: false,
          },
        });
      } catch (error) {
        log.error("File upload error", { error }, "FileRoutes");

        // 如果文件已上传但处理失败，尝试清理
        if (req.file && req.file.path) {
          try {
            if (fs.existsSync(req.file.path)) {
              fs.unlinkSync(req.file.path);
              log.debug("Cleaned up failed upload", { path: req.file.path }, "FileRoutes");
            }
          } catch (cleanupError) {
            log.error(
              "Failed to clean up file after upload error",
              { error: cleanupError },
              "FileRoutes",
            );
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
            log.error("File download error", { error: err }, "FileRoutes");
            if (!res.headersSent) {
              res.status(500).json({
                success: false,
                message: "Failed to download file",
              });
            }
          }
        });
      } catch (error) {
        log.error("File download error", { error }, "FileRoutes");
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
        log.error("File delete error", { error }, "FileRoutes");
        res.status(500).json({
          success: false,
          message: "Failed to delete file",
        });
      }
    },
  );

  return router;
};
