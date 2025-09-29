const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('crypto');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Configuration for external image hosting
const IMAGE_HOSTING = {
  enabled: process.env.EXTERNAL_IMAGE_HOSTING === 'true',
  baseUrl: process.env.IMAGE_HOST_URL || 'https://holwert.appenvloed.com',
  uploadEndpoint: process.env.IMAGE_UPLOAD_ENDPOINT || '/api/upload',
  apiKey: process.env.IMAGE_HOST_API_KEY || ''
};

// Ensure upload directories exist (for local fallback)
const ensureUploadDirs = async () => {
  if (IMAGE_HOSTING.enabled) return; // Skip if using external hosting
  
  const dirs = [
    'uploads/original',
    'uploads/compressed',
    'uploads/thumbnails',
    'uploads/profiles',
    'uploads/news',
    'uploads/events',
    'uploads/organizations'
  ];
  
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.error(`Error creating directory ${dir}:`, error);
      }
    }
  }
};

// Initialize upload directories
ensureUploadDirs();

// Multer configuration for memory storage (we'll process with Sharp)
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Alleen JPEG, PNG en WebP afbeeldingen zijn toegestaan'), false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    files: 5 // Max 5 files per request
  }
});

// Image processing configurations
const imageConfigs = {
  profile: {
    sizes: [
      { name: 'original', width: null, height: null, quality: 90 },
      { name: 'large', width: 800, height: 800, quality: 85 },
      { name: 'medium', width: 400, height: 400, quality: 80 },
      { name: 'thumbnail', width: 150, height: 150, quality: 75 }
    ],
    format: 'jpeg'
  },
  news: {
    sizes: [
      { name: 'original', width: null, height: null, quality: 90 },
      { name: 'large', width: 1200, height: 800, quality: 85 },
      { name: 'medium', width: 600, height: 400, quality: 80 },
      { name: 'thumbnail', width: 300, height: 200, quality: 75 }
    ],
    format: 'jpeg'
  },
  event: {
    sizes: [
      { name: 'original', width: null, height: null, quality: 90 },
      { name: 'large', width: 1200, height: 800, quality: 85 },
      { name: 'medium', width: 600, height: 400, quality: 80 },
      { name: 'thumbnail', width: 300, height: 200, quality: 75 }
    ],
    format: 'jpeg'
  },
  organization: {
    sizes: [
      { name: 'original', width: null, height: null, quality: 90 },
      { name: 'large', width: 800, height: 600, quality: 85 },
      { name: 'medium', width: 400, height: 300, quality: 80 },
      { name: 'thumbnail', width: 200, height: 150, quality: 75 }
    ],
    format: 'jpeg'
  }
};

// Generate unique filename
const generateFilename = (originalName, type, size = 'original') => {
  const ext = path.extname(originalName).toLowerCase();
  const baseName = path.basename(originalName, ext);
  const timestamp = Date.now();
  const randomId = uuidv4().substring(0, 8);
  
  return `${baseName}_${timestamp}_${randomId}_${size}${ext}`;
};

// Upload image to external hosting
const uploadToExternalHost = async (buffer, filename, type) => {
  try {
    const formData = new FormData();
    formData.append('image', buffer, {
      filename: filename,
      contentType: 'image/jpeg'
    });
    formData.append('type', type);
    formData.append('filename', filename);

    const response = await fetch(`${IMAGE_HOSTING.baseUrl}${IMAGE_HOSTING.uploadEndpoint}`, {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${IMAGE_HOSTING.apiKey}`,
        ...formData.getHeaders()
      }
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return {
      filename,
      url: result.url || `${IMAGE_HOSTING.baseUrl}/uploads/${type}s/${filename}`,
      size: 'original',
      dimensions: 'original'
    };
  } catch (error) {
    console.error('External upload failed:', error);
    throw error;
  }
};

// Process and save image (local or external)
const processImage = async (buffer, originalName, type, size) => {
  const config = imageConfigs[type];
  if (!config) {
    throw new Error(`Onbekend image type: ${type}`);
  }

  const sizeConfig = config.sizes.find(s => s.name === size);
  if (!sizeConfig) {
    throw new Error(`Onbekend size: ${size}`);
  }

  let sharpInstance = sharp(buffer);

  // Resize if dimensions are specified
  if (sizeConfig.width && sizeConfig.height) {
    sharpInstance = sharpInstance.resize(sizeConfig.width, sizeConfig.height, {
      fit: 'cover',
      position: 'center'
    });
  }

  // Convert to specified format and apply quality
  if (config.format === 'jpeg') {
    sharpInstance = sharpInstance.jpeg({ 
      quality: sizeConfig.quality,
      progressive: true,
      mozjpeg: true
    });
  } else if (config.format === 'webp') {
    sharpInstance = sharpInstance.webp({ 
      quality: sizeConfig.quality 
    });
  }

  // Generate filename
  const filename = generateFilename(originalName, type, size);
  
  // Process image to buffer
  const processedBuffer = await sharpInstance.toBuffer();

  // Upload to external host if enabled
  if (IMAGE_HOSTING.enabled) {
    return await uploadToExternalHost(processedBuffer, filename, type);
  }

  // Local storage fallback
  const dirPath = `uploads/${type}s`;
  const filePath = path.join(dirPath, filename);

  // Ensure directory exists
  await fs.mkdir(dirPath, { recursive: true });

  // Save locally
  await fs.writeFile(filePath, processedBuffer);

  return {
    filename,
    path: filePath,
    url: `/uploads/${type}s/${filename}`,
    size: sizeConfig.name,
    dimensions: sizeConfig.width ? `${sizeConfig.width}x${sizeConfig.height}` : 'original'
  };
};

// Process multiple sizes of an image
const processImageSizes = async (buffer, originalName, type) => {
  const config = imageConfigs[type];
  const results = {};

  for (const sizeConfig of config.sizes) {
    try {
      const result = await processImage(buffer, originalName, type, sizeConfig.name);
      results[sizeConfig.name] = result;
    } catch (error) {
      console.error(`Error processing ${sizeConfig.name} size:`, error);
      throw error;
    }
  }

  return results;
};

// Delete image files (external or local)
const deleteImage = async (imagePath) => {
  try {
    if (IMAGE_HOSTING.enabled) {
      // Delete from external host
      const response = await fetch(`${IMAGE_HOSTING.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${IMAGE_HOSTING.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: imagePath })
      });
      
      if (!response.ok) {
        console.error('Failed to delete from external host:', response.status);
      }
    } else {
      // Delete locally
      if (imagePath && imagePath.startsWith('uploads/')) {
        await fs.unlink(imagePath);
      }
    }
  } catch (error) {
    console.error('Error deleting image:', error);
  }
};

// Delete all sizes of an image
const deleteImageSizes = async (imageData) => {
  if (!imageData || typeof imageData !== 'object') return;

  const deletePromises = [];
  
  // Delete all size variants
  Object.values(imageData).forEach(sizeData => {
    if (sizeData && (sizeData.path || sizeData.url)) {
      deletePromises.push(deleteImage(sizeData.path || sizeData.url));
    }
  });

  await Promise.all(deletePromises);
};

// Get image info
const getImageInfo = async (imagePath) => {
  try {
    if (IMAGE_HOSTING.enabled) {
      // For external hosting, we can't easily get metadata
      return {
        width: null,
        height: null,
        format: 'jpeg',
        size: null,
        hasAlpha: false
      };
    }

    const metadata = await sharp(imagePath).metadata();
    const stats = await fs.stat(imagePath);
    
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: stats.size,
      hasAlpha: metadata.hasAlpha
    };
  } catch (error) {
    console.error('Error getting image info:', error);
    return null;
  }
};

// Optimize existing image
const optimizeImage = async (inputPath, outputPath, options = {}) => {
  const {
    width = null,
    height = null,
    quality = 85,
    format = 'jpeg'
  } = options;

  let sharpInstance = sharp(inputPath);

  if (width && height) {
    sharpInstance = sharpInstance.resize(width, height, {
      fit: 'cover',
      position: 'center'
    });
  }

  if (format === 'jpeg') {
    sharpInstance = sharpInstance.jpeg({ 
      quality,
      progressive: true,
      mozjpeg: true
    });
  } else if (format === 'webp') {
    sharpInstance = sharpInstance.webp({ quality });
  }

  await sharpInstance.toFile(outputPath);
  return outputPath;
};

module.exports = {
  upload,
  processImage,
  processImageSizes,
  deleteImage,
  deleteImageSizes,
  getImageInfo,
  optimizeImage,
  imageConfigs,
  ensureUploadDirs,
  IMAGE_HOSTING
};