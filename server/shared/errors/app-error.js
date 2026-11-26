class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = statusCode < 500 || statusCode === 501;
  }
}

module.exports = AppError;
