import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticateRoom } from '../middleware/auth';
import { validateParams } from '../middleware/validation';
import { uploadRateLimit, generalRateLimit } from '../middleware/rateLimit';
import { sanitizeFileName } from '@cloud-clipboard/shared';
import type { FileInfo } from '@cloud-clipboard/shared';
import * as fs from 'fs';
import * as path from 'path';
import type { FileManager } from '../services/FileManager';

const getProtocol = (req: any): string => {
  // Check for ALLOW_HTTP environment variable
  const allowHttp = process.env.ALLOW_HTTP === 'true';
  
  if (allowHttp) {
    // If HTTP is allowed, use the actual protocol from the request
    return req.protocol;
  }
  
  // Default behavior: prefer HTTPS
  return req.secure ? 'https' : 'http';
};

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const sanitized = sanitizeFileName(file.originalname);
    const timestamp = Date.now();
    cb(null, `${timestamp}-${sanitized}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    // Security: Only allow safe file types
    const allowedMimeTypes = [
      'text/plain', 'text/csv', 'text/html', 'text/css', 'text/javascript',
      'application/json', 'application/xml', 'application/pdf',
      'application/zip', 'application/x-zip-compressed',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
      'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm'
    ];
    
    const dangerousExtensions = [
      '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.jar',
      '.sh', '.bash', '.ps1', '.vbs', '.js', '.php', '.asp', '.aspx', '.jsp'
    ];
    
    // Check MIME type
    if (!allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
      return;
    }
    
    // Check file extension
    const fileExtension = path.extname(file.originalname).toLowerCase();
    if (dangerousExtensions.includes(fileExtension)) {
      cb(new Error(`File extension ${fileExtension} is not allowed`));
      return;
    }
    
    // Additional filename validation
    if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
      cb(new Error('Invalid filename'));
      return;
    }
    
    cb(null, true);
  },
});

const FileParamsSchema = z.object({
  fileId: z.string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/, 'Invalid file ID format')
    .refine(
      (fileId) => !fileId.includes('..') && !fileId.includes('/') && !fileId.includes('\\'),
      'File ID contains invalid characters'
    ),
});

export const createFileRoutes = (fileManager: FileManager): Router => {
  router.post('/upload', uploadRateLimit.middleware(), authenticateRoom, upload.single('file'), (req, res: any) => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          message: 'No file uploaded',
        });
        return;
      }

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
      
      // Track file in FileManager
      fileManager.addFile({
        id: req.file.filename,
        filename: req.file.originalname,
        path: req.file.path,
        roomKey: req.roomKey!,
        uploadedAt: new Date(),
        size: req.file.size,
      });

      res.json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          fileId: fileData.id,
          downloadUrl: `${getProtocol(req)}://${req.get('host')}/api/files/download/${fileData.id}`,
          ...fileInfo,
        },
      });
    } catch (error) {
      console.error('File upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload file',
      });
    }
  });

  router.get('/download/:fileId', generalRateLimit.middleware(), validateParams(FileParamsSchema), (req, res: any) => {
    try {
      const { fileId } = req.params as { fileId: string };
      
      // Security: Strict path validation to prevent directory traversal
      const uploadsDir = path.resolve(process.cwd(), 'uploads');
      const filePath = path.resolve(uploadsDir, fileId);
      
      // Ensure the resolved path is still within uploads directory
      if (!filePath.startsWith(uploadsDir + path.sep)) {
        res.status(403).json({
          success: false,
          message: 'Access denied: Invalid file path',
        });
        return;
      }

      if (!fs.existsSync(filePath)) {
        res.status(404).json({
          success: false,
          message: 'File not found',
        });
        return;
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        res.status(404).json({
          success: false,
          message: 'File not found',
        });
        return;
      }

      // Security: Verify file is in our FileManager tracking
      const fileInfo = fileManager?.getFile(fileId);
      if (!fileInfo) {
        res.status(404).json({
          success: false,
          message: 'File not found',
        });
        return;
      }

      res.download(filePath, (err: any) => {
        if (err) {
          console.error('File download error:', err);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              message: 'Failed to download file',
            });
          }
        }
      });
    } catch (error) {
      console.error('File download error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Failed to download file',
        });
      }
    }
  });

  router.delete('/:fileId', generalRateLimit.middleware(), authenticateRoom, validateParams(FileParamsSchema), (req, res: any) => {
    try {
      const { fileId } = req.params as { fileId: string };
      
      // Security: Verify file exists in our tracking system
      const fileInfo = fileManager?.getFile(fileId);
      if (!fileInfo) {
        res.status(404).json({
          success: false,
          message: 'File not found',
        });
        return;
      }
      
      // Security: Verify user has access to this file's room
      if (fileInfo.roomKey !== req.roomKey!) {
        res.status(403).json({
          success: false,
          message: 'Access denied',
        });
        return;
      }

      // Delete file using FileManager (safer than direct file operations)
      const result = fileManager?.deleteFile(fileId, 'manual');
      if (!result) {
        res.status(500).json({
          success: false,
          message: 'Failed to delete file',
        });
        return;
      }

      res.json({
        success: true,
        message: 'File deleted successfully',
      });
    } catch (error) {
      console.error('File delete error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete file',
      });
    }
  });

  return router;
};