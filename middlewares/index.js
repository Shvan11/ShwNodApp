/**
 * Middleware collection
 */
import express from 'express';

/**
 * Common middleware setup
 * @param {Express} app - Express application
 */
function setupMiddleware(app) {
  // CORS middleware
  app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS, PUT, PATCH, DELETE'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-Requested-With,content-type'
    );
    res.setHeader('Access-Control-Allow-Credentials', true);
    next();
  });

  // Body parser middleware
  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ extended: true, limit: '200mb' }));
}

export { setupMiddleware };
