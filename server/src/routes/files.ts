import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticateRoom } from '../middleware/auth';
import { validateParams } from '../middleware/validation';
import { sanitizeFileName } from '@cloud-clipboard/shared';
import type { APIResponse, FileInfo } from '@cloud-clipboard/shared';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
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
  fileFilter: (req, file, cb) => {
    // Allow all file types for now, but you can add restrictions here
    cb(null, true);
  },
});

const FileParamsSchema = z.object({
  fileId: z.string().min(1),
});

export const createFileRoutes = (): Router => {
  router.post('/upload', authenticateRoom, upload.single('file'), (req, res: any) => {
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

      res.json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          fileId: fileData.id,
          downloadUrl: `${req.secure ? 'https' : 'http'}://${req.get('host')}/api/files/download/${fileData.id}`,
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

  router.get('/download/:fileId', validateParams(FileParamsSchema), (req, res: any) => {
    try {
      const { fileId } = req.params;
      const filePath = path.join(process.cwd(), 'uploads', fileId);

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

      res.download(filePath, (err) => {
        if (err) {
          console.error('File download error:', err);
          res.status(500).json({
            success: false,
            message: 'Failed to download file',
          });
        }
      });
    } catch (error) {
      console.error('File download error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download file',
      });
    }
  });

  router.delete('/:fileId', authenticateRoom, validateParams(FileParamsSchema), (req, res: any) => {
    try {
      const { fileId } = req.params;
      const filePath = path.join(process.cwd(), 'uploads', fileId);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
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