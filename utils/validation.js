const Joi = require('joi');
const { body, param, query, validationResult } = require('express-validator');

// Custom validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validatiefout',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

// Joi schemas for complex validation
const schemas = {
  user: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Geldig e-mailadres is vereist',
      'any.required': 'E-mailadres is vereist'
    }),
    password: Joi.string().min(6).max(128).required().messages({
      'string.min': 'Wachtwoord moet minimaal 6 karakters bevatten',
      'string.max': 'Wachtwoord mag maximaal 128 karakters bevatten',
      'any.required': 'Wachtwoord is vereist'
    }),
    firstName: Joi.string().min(2).max(50).required().messages({
      'string.min': 'Voornaam moet minimaal 2 karakters bevatten',
      'string.max': 'Voornaam mag maximaal 50 karakters bevatten',
      'any.required': 'Voornaam is vereist'
    }),
    lastName: Joi.string().min(2).max(50).required().messages({
      'string.min': 'Achternaam moet minimaal 2 karakters bevatten',
      'string.max': 'Achternaam mag maximaal 50 karakters bevatten',
      'any.required': 'Achternaam is vereist'
    }),
    role: Joi.string().valid('superadmin', 'admin', 'user').required().messages({
      'any.only': 'Rol moet superadmin, admin of user zijn',
      'any.required': 'Rol is vereist'
    }),
    organizationId: Joi.number().integer().positive().allow(null),
    phone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{10,15}$/).allow('').messages({
      'string.pattern.base': 'Ongeldig telefoonnummer formaat'
    }),
    address: Joi.string().max(200).allow(''),
    isActive: Joi.boolean().default(true)
  }),

  organization: Joi.object({
    name: Joi.string().min(2).max(100).required().messages({
      'string.min': 'Organisatienaam moet minimaal 2 karakters bevatten',
      'string.max': 'Organisatienaam mag maximaal 100 karakters bevatten',
      'any.required': 'Organisatienaam is vereist'
    }),
    description: Joi.string().max(1000).allow(''),
    type: Joi.string().valid('vereniging', 'bedrijf', 'gemeente', 'school', 'kerk', 'overig').required().messages({
      'any.only': 'Type moet vereniging, bedrijf, gemeente, school, kerk of overig zijn',
      'any.required': 'Type is vereist'
    }),
    email: Joi.string().email().allow('').messages({
      'string.email': 'Geldig e-mailadres is vereist'
    }),
    phone: Joi.string().pattern(/^[\+]?[0-9\s\-\(\)]{10,15}$/).allow('').messages({
      'string.pattern.base': 'Ongeldig telefoonnummer formaat'
    }),
    website: Joi.string().uri().allow('').messages({
      'string.uri': 'Geldige website URL is vereist'
    }),
    address: Joi.string().max(200).allow(''),
    isActive: Joi.boolean().default(true)
  }),

  news: Joi.object({
    title: Joi.string().min(5).max(200).required().messages({
      'string.min': 'Titel moet minimaal 5 karakters bevatten',
      'string.max': 'Titel mag maximaal 200 karakters bevatten',
      'any.required': 'Titel is vereist'
    }),
    content: Joi.string().min(10).max(10000).required().messages({
      'string.min': 'Inhoud moet minimaal 10 karakters bevatten',
      'string.max': 'Inhoud mag maximaal 10000 karakters bevatten',
      'any.required': 'Inhoud is vereist'
    }),
    excerpt: Joi.string().max(500).allow(''),
    category: Joi.string().valid('algemeen', 'sport', 'cultuur', 'onderwijs', 'zorg', 'verkeer', 'overig').required().messages({
      'any.only': 'Categorie moet algemeen, sport, cultuur, onderwijs, zorg, verkeer of overig zijn',
      'any.required': 'Categorie is vereist'
    }),
    isPublished: Joi.boolean().default(false),
    publishDate: Joi.date().allow(null),
    organizationId: Joi.number().integer().positive().allow(null)
  }),

  event: Joi.object({
    title: Joi.string().min(5).max(200).required().messages({
      'string.min': 'Titel moet minimaal 5 karakters bevatten',
      'string.max': 'Titel mag maximaal 200 karakters bevatten',
      'any.required': 'Titel is vereist'
    }),
    description: Joi.string().min(10).max(2000).required().messages({
      'string.min': 'Beschrijving moet minimaal 10 karakters bevatten',
      'string.max': 'Beschrijving mag maximaal 2000 karakters bevatten',
      'any.required': 'Beschrijving is vereist'
    }),
    startDate: Joi.date().required().messages({
      'any.required': 'Startdatum is vereist'
    }),
    endDate: Joi.date().min(Joi.ref('startDate')).allow(null).messages({
      'date.min': 'Einddatum moet na startdatum liggen'
    }),
    location: Joi.string().max(200).required().messages({
      'string.max': 'Locatie mag maximaal 200 karakters bevatten',
      'any.required': 'Locatie is vereist'
    }),
    category: Joi.string().valid('sport', 'cultuur', 'onderwijs', 'zorg', 'vereniging', 'overig').required().messages({
      'any.only': 'Categorie moet sport, cultuur, onderwijs, zorg, vereniging of overig zijn',
      'any.required': 'Categorie is vereist'
    }),
    isPublic: Joi.boolean().default(true),
    maxAttendees: Joi.number().integer().min(1).allow(null),
    organizationId: Joi.number().integer().positive().allow(null)
  }),

  foundLost: Joi.object({
    type: Joi.string().valid('found', 'lost').required().messages({
      'any.only': 'Type moet found of lost zijn',
      'any.required': 'Type is vereist'
    }),
    title: Joi.string().min(5).max(200).required().messages({
      'string.min': 'Titel moet minimaal 5 karakters bevatten',
      'string.max': 'Titel mag maximaal 200 karakters bevatten',
      'any.required': 'Titel is vereist'
    }),
    description: Joi.string().min(10).max(1000).required().messages({
      'string.min': 'Beschrijving moet minimaal 10 karakters bevatten',
      'string.max': 'Beschrijving mag maximaal 1000 karakters bevatten',
      'any.required': 'Beschrijving is vereist'
    }),
    category: Joi.string().valid('dier', 'fiets', 'sleutels', 'tas', 'telefoon', 'overig').required().messages({
      'any.only': 'Categorie moet dier, fiets, sleutels, tas, telefoon of overig zijn',
      'any.required': 'Categorie is vereist'
    }),
    location: Joi.string().max(200).required().messages({
      'string.max': 'Locatie mag maximaal 200 karakters bevatten',
      'any.required': 'Locatie is vereist'
    }),
    contactInfo: Joi.string().max(200).allow(''),
    isResolved: Joi.boolean().default(false)
  })
};

// Express-validator rules
const validationRules = {
  // User validation
  createUser: [
    body('email').isEmail().normalizeEmail().withMessage('Geldig e-mailadres is vereist'),
    body('password').isLength({ min: 6, max: 128 }).withMessage('Wachtwoord moet 6-128 karakters bevatten'),
    body('firstName').isLength({ min: 2, max: 50 }).trim().withMessage('Voornaam moet 2-50 karakters bevatten'),
    body('lastName').isLength({ min: 2, max: 50 }).trim().withMessage('Achternaam moet 2-50 karakters bevatten'),
    body('role').isIn(['superadmin', 'admin', 'user']).withMessage('Ongeldige rol'),
    body('organizationId').optional().isInt({ min: 1 }).withMessage('Ongeldige organisatie ID'),
    body('phone').optional().matches(/^[\+]?[0-9\s\-\(\)]{10,15}$/).withMessage('Ongeldig telefoonnummer'),
    body('address').optional().isLength({ max: 200 }).withMessage('Adres mag maximaal 200 karakters bevatten'),
    validate
  ],

  updateUser: [
    param('id').isInt({ min: 1 }).withMessage('Ongeldige gebruiker ID'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Geldig e-mailadres is vereist'),
    body('firstName').optional().isLength({ min: 2, max: 50 }).trim().withMessage('Voornaam moet 2-50 karakters bevatten'),
    body('lastName').optional().isLength({ min: 2, max: 50 }).trim().withMessage('Achternaam moet 2-50 karakters bevatten'),
    body('role').optional().isIn(['superadmin', 'admin', 'user']).withMessage('Ongeldige rol'),
    body('organizationId').optional().isInt({ min: 1 }).withMessage('Ongeldige organisatie ID'),
    body('phone').optional().matches(/^[\+]?[0-9\s\-\(\)]{10,15}$/).withMessage('Ongeldig telefoonnummer'),
    body('address').optional().isLength({ max: 200 }).withMessage('Adres mag maximaal 200 karakters bevatten'),
    body('isActive').optional().isBoolean().withMessage('isActive moet boolean zijn'),
    validate
  ],

  // Organization validation
  createOrganization: [
    body('name').isLength({ min: 2, max: 100 }).trim().withMessage('Naam moet 2-100 karakters bevatten'),
    body('description').optional().isLength({ max: 1000 }).withMessage('Beschrijving mag maximaal 1000 karakters bevatten'),
    body('type').isIn(['vereniging', 'bedrijf', 'gemeente', 'school', 'kerk', 'overig']).withMessage('Ongeldig type'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Geldig e-mailadres is vereist'),
    body('phone').optional().matches(/^[\+]?[0-9\s\-\(\)]{10,15}$/).withMessage('Ongeldig telefoonnummer'),
    body('website').optional().isURL().withMessage('Geldige website URL is vereist'),
    body('address').optional().isLength({ max: 200 }).withMessage('Adres mag maximaal 200 karakters bevatten'),
    validate
  ],

  // News validation
  createNews: [
    body('title').isLength({ min: 5, max: 200 }).trim().withMessage('Titel moet 5-200 karakters bevatten'),
    body('content').isLength({ min: 10, max: 10000 }).withMessage('Inhoud moet 10-10000 karakters bevatten'),
    body('excerpt').optional().isLength({ max: 500 }).withMessage('Excerpt mag maximaal 500 karakters bevatten'),
    body('category').isIn(['algemeen', 'sport', 'cultuur', 'onderwijs', 'zorg', 'verkeer', 'overig']).withMessage('Ongeldige categorie'),
    body('isPublished').optional().isBoolean().withMessage('isPublished moet boolean zijn'),
    body('publishDate').optional().isISO8601().withMessage('Ongeldige publicatiedatum'),
    body('organizationId').optional().isInt({ min: 1 }).withMessage('Ongeldige organisatie ID'),
    validate
  ],

  // Event validation
  createEvent: [
    body('title').isLength({ min: 5, max: 200 }).trim().withMessage('Titel moet 5-200 karakters bevatten'),
    body('description').isLength({ min: 10, max: 2000 }).withMessage('Beschrijving moet 10-2000 karakters bevatten'),
    body('startDate').isISO8601().withMessage('Ongeldige startdatum'),
    body('endDate').optional().isISO8601().withMessage('Ongeldige einddatum'),
    body('location').isLength({ min: 1, max: 200 }).trim().withMessage('Locatie moet 1-200 karakters bevatten'),
    body('category').isIn(['sport', 'cultuur', 'onderwijs', 'zorg', 'vereniging', 'overig']).withMessage('Ongeldige categorie'),
    body('isPublic').optional().isBoolean().withMessage('isPublic moet boolean zijn'),
    body('maxAttendees').optional().isInt({ min: 1 }).withMessage('Maximaal aantal deelnemers moet positief zijn'),
    body('organizationId').optional().isInt({ min: 1 }).withMessage('Ongeldige organisatie ID'),
    validate
  ],

  // Found/Lost validation
  createFoundLost: [
    body('type').isIn(['found', 'lost']).withMessage('Type moet found of lost zijn'),
    body('title').isLength({ min: 5, max: 200 }).trim().withMessage('Titel moet 5-200 karakters bevatten'),
    body('description').isLength({ min: 10, max: 1000 }).withMessage('Beschrijving moet 10-1000 karakters bevatten'),
    body('category').isIn(['dier', 'fiets', 'sleutels', 'tas', 'telefoon', 'overig']).withMessage('Ongeldige categorie'),
    body('location').isLength({ min: 1, max: 200 }).trim().withMessage('Locatie moet 1-200 karakters bevatten'),
    body('contactInfo').optional().isLength({ max: 200 }).withMessage('Contactinfo mag maximaal 200 karakters bevatten'),
    body('isResolved').optional().isBoolean().withMessage('isResolved moet boolean zijn'),
    validate
  ],

  // Common parameter validation
  idParam: [
    param('id').isInt({ min: 1 }).withMessage('Ongeldige ID'),
    validate
  ],

  // Pagination validation
  pagination: [
    query('page').optional().isInt({ min: 1 }).withMessage('Pagina moet positief zijn'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit moet tussen 1 en 100 zijn'),
    validate
  ]
};

// Joi validation middleware
const validateWithJoi = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { 
      abortEarly: false,
      stripUnknown: true 
    });
    
    if (error) {
      return res.status(400).json({
        error: 'Validatiefout',
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }))
      });
    }
    
    req.body = value; // Use validated and sanitized data
    next();
  };
};

// Sanitize input
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return obj.trim().replace(/[<>]/g, '');
    }
    if (typeof obj === 'object' && obj !== null) {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitize(req.body);
  }
  if (req.query) {
    req.query = sanitize(req.query);
  }
  if (req.params) {
    req.params = sanitize(req.params);
  }

  next();
};

module.exports = {
  validate,
  validationRules,
  schemas,
  validateWithJoi,
  sanitizeInput
};
